"""Private Android key setup and signed builds; never prints secret values."""
import argparse
import base64
import ctypes
import hashlib
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
REPO = "vkorotchenko/esp32_pixies"
DIRECTORY = Path.home() / ".config/esp32_pixies/signing"
KEY = DIRECTORY / "release.p12"
SERVICE = b"esp32-pixies-android-release"
ACCOUNT = b"pixies-release"
ALIAS = "pixies-release"


def keychain(password=None):
    if sys.platform != "darwin":
        raise ValueError("Automatic key storage requires macOS; supply signing environment variables elsewhere")
    library = ctypes.CDLL("/System/Library/Frameworks/Security.framework/Security")
    if password is not None:
        library.SecKeychainAddGenericPassword.argtypes = [
            ctypes.c_void_p, ctypes.c_uint32, ctypes.c_char_p, ctypes.c_uint32,
            ctypes.c_char_p, ctypes.c_uint32, ctypes.c_char_p, ctypes.c_void_p]
        result = library.SecKeychainAddGenericPassword(
            None, len(SERVICE), SERVICE, len(ACCOUNT), ACCOUNT, len(password), password, None)
    else:
        length, data = ctypes.c_uint32(), ctypes.c_void_p()
        library.SecKeychainFindGenericPassword.argtypes = [
            ctypes.c_void_p, ctypes.c_uint32, ctypes.c_char_p, ctypes.c_uint32,
            ctypes.c_char_p, ctypes.POINTER(ctypes.c_uint32),
            ctypes.POINTER(ctypes.c_void_p), ctypes.c_void_p]
        result = library.SecKeychainFindGenericPassword(
            None, len(SERVICE), SERVICE, len(ACCOUNT), ACCOUNT,
            ctypes.byref(length), ctypes.byref(data), None)
        if result == -25300:
            return None
        if result == 0:
            value = ctypes.string_at(data, length.value)
            library.SecKeychainItemFreeContent.argtypes = [ctypes.c_void_p, ctypes.c_void_p]
            library.SecKeychainItemFreeContent(None, data)
            return value
    if result != 0:
        raise ValueError(f"Keychain operation failed (OSStatus {result}); unlock your login keychain")
    return None


def environment():
    env = os.environ.copy()
    java17 = Path("/Library/Java/JavaVirtualMachines/jdk-17.jdk/Contents/Home")
    if sys.platform == "darwin" and java17.exists():
        env["JAVA_HOME"] = str(java17)
        env["PATH"] = str(java17 / "bin") + os.pathsep + env["PATH"]
    if "ANDROID_HOME" not in env and sys.platform == "darwin":
        env["ANDROID_HOME"] = str(Path.home() / "Library/Android/sdk")
    return env


def gh(*args, body=None):
    result = subprocess.run(["gh", *args], input=body, stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, check=False)
    if result.returncode:
        raise ValueError(result.stderr.decode("utf-8", "replace").strip())
    return result.stdout


def setup():
    login = gh("api", "user", "--jq", ".login").decode().strip()
    if login != "vkorotchenko":
        raise ValueError("Use the repository owner's GitHub identity; do not switch global authentication")
    gh("api", "--method", "PUT", f"repos/{REPO}/environments/release", "--input", "-",
       body=json.dumps({"deployment_branch_policy": {
           "protected_branches": False, "custom_branch_policies": True}}).encode())
    policies = json.loads(gh("api", f"repos/{REPO}/environments/release/deployment-branch-policies"))
    if not any(p["name"] == "main" and p.get("type") == "branch"
               for p in policies["branch_policies"]):
        gh("api", "--method", "POST",
           f"repos/{REPO}/environments/release/deployment-branch-policies", "--input", "-",
           body=b'{"name":"main","type":"branch"}')
    existing = json.loads(gh("secret", "list", "--repo", REPO, "--env", "release", "--json", "name"))
    if existing and not KEY.exists():
        raise ValueError("Release secrets already exist but the local key is missing; restore the original key, never replace it")
    DIRECTORY.mkdir(parents=True, exist_ok=True, mode=0o700)
    DIRECTORY.chmod(0o700)
    password = keychain()
    if KEY.exists() and password is None:
        raise ValueError("Private key exists but its Keychain password is missing; restore it before proceeding")
    if password is None:
        password = secrets.token_urlsafe(40).encode()
        keychain(password)
    env = environment()
    env["PIXIES_SETUP_PASSWORD"] = password.decode()
    if not KEY.exists():
        subprocess.run(["keytool", "-genkeypair", "-keystore", str(KEY), "-storetype", "PKCS12",
                        "-alias", ALIAS, "-keyalg", "RSA", "-keysize", "3072", "-validity", "10000",
                        "-dname", "CN=Pixies Release", "-storepass:env", "PIXIES_SETUP_PASSWORD",
                        "-keypass:env", "PIXIES_SETUP_PASSWORD"], env=env, check=True,
                       stdout=subprocess.DEVNULL)
    KEY.chmod(0o600)
    with tempfile.TemporaryDirectory(prefix="pixies-public-certificate-") as temporary:
        certificate = Path(temporary) / "release.der"
        subprocess.run(["keytool", "-exportcert", "-keystore", str(KEY), "-alias", ALIAS,
                        "-storepass:env", "PIXIES_SETUP_PASSWORD", "-file", str(certificate)],
                       env=env, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        fingerprint = hashlib.sha256(certificate.read_bytes()).hexdigest()
    public_pin = ROOT / "android-signing.sha256"
    if public_pin.exists() and public_pin.read_text().strip() != fingerprint:
        raise ValueError("Release certificate changed; refusing key rotation")
    public_pin.write_text(fingerprint + "\n")
    values = {"ANDROID_KEYSTORE_BASE64": base64.b64encode(KEY.read_bytes()),
              "ANDROID_KEYSTORE_PASSWORD": password,
              "ANDROID_KEY_ALIAS": ALIAS.encode(), "ANDROID_KEY_PASSWORD": password}
    for name, value in values.items():
        gh("secret", "set", name, "--repo", REPO, "--env", "release", body=value)
    names = json.loads(gh("secret", "list", "--repo", REPO, "--env", "release", "--json", "name"))
    if not set(values).issubset({item["name"] for item in names}):
        raise ValueError("Release secret setup could not be verified")
    print(f"Release signing configured. Private key: {KEY}")
    print("Password: macOS login Keychain, service esp32-pixies-android-release.")
    print("Back up both the private keystore and its Keychain password securely; do not regenerate.")
    print(f"Public certificate SHA-256: {fingerprint}")


def build(architectures):
    if not architectures or any(c not in "abcdefghijklmnopqrstuvwxyz0123456789_,-" for c in architectures):
        raise ValueError("Invalid Android architecture list")
    env = environment()
    names = ("ANDROID_KEYSTORE_PATH", "ANDROID_KEYSTORE_PASSWORD", "ANDROID_KEY_ALIAS", "ANDROID_KEY_PASSWORD")
    if not all(env.get(name) for name in names):
        if any(env.get(name) for name in names):
            raise ValueError("Incomplete signing environment; provide all four signing variables")
        if not KEY.is_file():
            raise ValueError("No release key: run make signing-setup")
        password = keychain()
        if password is None:
            raise ValueError("Release key password is missing from Keychain")
        env.update(ANDROID_KEYSTORE_PATH=str(KEY), ANDROID_KEYSTORE_PASSWORD=password.decode(),
                   ANDROID_KEY_ALIAS=ALIAS, ANDROID_KEY_PASSWORD=password.decode())
    subprocess.run(["npm", "run", "apk", "--", f"-PreactNativeArchitectures={architectures}"],
                   cwd=ROOT / "mobile", env=env, check=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("setup")
    command = commands.add_parser("build")
    command.add_argument("--architectures", default="arm64-v8a")
    args = parser.parse_args()
    if args.command == "setup":
        setup()
    else:
        build(args.architectures)


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        sys.exit(f"Signing error: {error}")
