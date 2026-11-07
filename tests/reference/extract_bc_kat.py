"""Extract XMSS-SHA2 known-answer vectors from Bouncy Castle's XMSSTest.java.

Usage: python3 -I extract_bc_kat.py <path to XMSSTest.java> <output json>

Independent of @qsd/crypto's own vectors file: this parses the Java source
directly. Only SHA-256 vectors are extracted.
"""
import json
import re
import sys

src_path, out_path = sys.argv[1], sys.argv[2]
with open(src_path, encoding="utf-8") as f:
    src = f.read()


def body(name: str) -> str:
    i = src.index(f"public void {name}()")
    j = src.index("    public void ", i + 10)
    return src[i:j]


def hex_strings(block: str, min_len: int = 64):
    return [s for s in re.findall(r'"([0-9a-f]+)"', block) if len(s) >= min_len]


auth = body("testAuthPath")
auth_path = hex_strings(auth)
assert len(auth_path) == 10, len(auth_path)
assert "XMSSParameters(10, new SHA256Digest())" in auth

gen = body("testGenKeyPairSHA256")
priv, pub = hex_strings(gen)
assert pub.startswith("00000001")
root10 = pub[8:72]
pubseed10 = pub[72:136]
assert pubseed10 == "0" * 64
assert "XMSSParameters(10, new SHA256Digest())" in gen

sign10 = body("testSignSHA256")
sigs10 = hex_strings(sign10)
assert len(sigs10) == 3 and "XMSSParameters(10, new SHA256Digest())" in sign10

h4 = body("testSignSHA256CompleteEvenHeight1")
sigs4 = hex_strings(h4)
assert len(sigs4) == 16 and "int height = 4;" in h4

h10 = body("testSignSHA256CompleteEvenHeight2")
sigs10b = hex_strings(h10)
assert len(sigs10b) == 10 and "int height = 10;" in h10
cases = [int(c, 16) for c in re.findall(r"case 0x([0-9a-f]+):", h10)]
assert len(cases) == 10

out = {
    "_source": "https://raw.githubusercontent.com/bcgit/bc-java/main/core/src/test/java/org/bouncycastle/pqc/crypto/test/XMSSTest.java",
    "_fetchedBy": "Agent H (verify), extracted with tests/reference/extract_bc_kat.py; not copied from packages/crypto/test/vectors",
    "_params": "XMSS-SHA2, n=32, w=16, len=67; NullPRNG => SK_SEED = SK_PRF = SEED = 32 zero bytes; message = 1024 zero bytes",
    "_derivation": "Bouncy Castle WOTS+ secret key: S_ots = PRF(SK_SEED, ADRS{type=OTS, ots=i, chain=0, hash=0, keyAndMask=0}); sk[j] = PRF(S_ots, toByte(j, 32))",
    "height10": {
        "root": root10,
        "pubSeed": pubseed10,
        "encodedPublicKey": pub,
        "authPathForIndex0": auth_path,
        "signatures": {str(i): s for i, s in enumerate(sigs10)},
        "scatteredSignatures": {str(idx): s for idx, s in zip(cases, sigs10b)},
    },
    "height4": {"signatures": {str(i): s for i, s in enumerate(sigs4)}},
}
with open(out_path, "w", encoding="utf-8") as f:
    json.dump(out, f, indent=1)
print("height10 root", root10)
print("height10 sig lens", sorted({len(s) // 2 for s in sigs10 + sigs10b}))
print("height4 sig lens", sorted({len(s) // 2 for s in sigs4}))
print("scattered indices", cases)
