import sys

print("-lcrypto" if sys.platform.startswith("linux") else "")
