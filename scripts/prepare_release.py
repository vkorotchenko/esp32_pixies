"""Open a version-only release PR from main, without bypassing reviews."""
import json
import os
import subprocess
import sys
from release import REPO, ROOT, bumped, read_version, run, sync


def main(kind):
    if os.environ.get("GITHUB_REF") != "refs/heads/main":
        raise ValueError("Release preparation must run from main")
    if run("git", "status", "--porcelain"):
        raise ValueError("Release preparation requires a clean checkout")
    if run("git", "rev-parse", "HEAD") != run("git", "ls-remote", "origin", "refs/heads/main").split()[0]:
        raise ValueError("Main advanced while preparation was queued; rerun the workflow")
    open_prs = json.loads(run("gh", "pr", "list", "--repo", REPO, "--base", "main",
                             "--state", "open", "--limit", "100", "--json", "headRefName,number"))
    if any(item["headRefName"].startswith("release/") for item in open_prs):
        raise ValueError("Finish or close the existing release PR before preparing another bump")
    current = read_version()
    published = json.loads(run("gh", "api", f"repos/{REPO}/releases/tags/v{current['version']}"))
    if published["draft"] or published["prerelease"]:
        raise ValueError("Publish/retry the current stable release before preparing another")
    value = bumped(current, kind)
    tag = f"v{value['version']}"
    branch = f"release/{tag}"
    if run("git", "ls-remote", "origin", f"refs/tags/{tag}", f"refs/heads/{branch}"):
        raise ValueError("Release tag/branch already exists; inspect the existing release PR")
    subprocess.run(["git", "switch", "-c", branch], cwd=ROOT, check=True)
    (ROOT / "version.json").write_text(json.dumps(value, indent=2) + "\n")
    sync()
    files = ["version.json", "include/version.h", "mobile/src/version.ts",
             "mobile/package.json", "mobile/package-lock.json",
             "mobile/ios/Pixies.xcodeproj/project.pbxproj"]
    subprocess.run(["git", "add", "--", *files], cwd=ROOT, check=True)
    subprocess.run(["git", "-c", "user.name=github-actions[bot]",
                    "-c", "user.email=41898282+github-actions[bot]@users.noreply.github.com",
                    "commit", "-m", f"chore: prepare {tag}\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"],
                   cwd=ROOT, check=True)
    subprocess.run(["git", "push", "origin", branch], cwd=ROOT, check=True)
    subprocess.run(["gh", "pr", "create", "--repo", REPO, "--base", "main", "--head", branch,
                    "--title", f"Release {tag}", "--body",
                    f"Prepare shared {kind} release {tag}. Android version code: {value['androidVersionCode']}.\n\n"
                    "Review and merge after CI passes. Merging triggers verified firmware/APK publication. "
                    "No device is flashed and no phone is installed automatically."], cwd=ROOT, check=True)
    # GITHUB_TOKEN-created PRs do not trigger pull_request workflows.
    for workflow in ("ci.yml", "mobile.yml"):
        subprocess.run(["gh", "workflow", "run", workflow, "--repo", REPO, "--ref", branch],
                       cwd=ROOT, check=True)


if __name__ == "__main__":
    try:
        if len(sys.argv) != 2:
            raise ValueError("Expected major, minor, or patch")
        main(sys.argv[1])
    except (ValueError, KeyError, OSError, subprocess.CalledProcessError) as error:
        sys.exit(f"Release preparation failed: {error}")
