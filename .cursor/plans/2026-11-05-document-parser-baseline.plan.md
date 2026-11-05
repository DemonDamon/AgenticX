# document-parser-baseline

Planned-with: gpt-6.1-sol
Suggested-Impl-Model: gpt-6.1-sol

## Evidence and scope
`pyproject.toml` desktop-runtime/document extras currently allow pypdf <5 and lock selects 4.3.1; official GHSA-5849-834g-hvw5 fixes an EOF infinite loop in 6.21.4. Locked Pillow 12.2.0 predates 13.0.0 security fixes; release 13 removes Python 3.10 support.
FR1: Require pypdf>=6.21.4,<7 in both extras. Explicitly constrain Pillow>=12.3.0,<13 for Python 3.10 and >=13.0.0,<14 for Python >=3.11. The 3.10 branch is a compatibility branch with known residual image-parser risk, not declared fully remediated.
FR2: Verify real PDF text/password/metadata and image-in-Office round trips, and check PyInstaller collection includes required image/PDF plugins and runtime resources.
FR3: Investigate the database extra cryptography<45 versus locked 48.0.0 mismatch from actual callers and resolver requirements before deciding a minimal compatible bound; do not update cipher semantics.
AC: `tests/tools/test_document_dependency_compatibility.py`, actual crypto callers if bounds change; independent Python 3.10/3.12 resolve; packaged resource collection/import smoke, reporting binary packaging separately.
Out of scope: changes to reader selection, OCR platform dependencies, server protocol or document UI.
Sources: https://github.com/advisories/GHSA-5849-834g-hvw5 ; https://pillow.readthedocs.io/en/stable/releasenotes/13.0.0.html ; https://pypi.org/project/pypdf/6.21.4/ .

## Bound decision and implementation
The database extra cryptography upper bound is widened from <45 to <49 while retaining the existing >=41 minimum, matching the already locked 48.0.0. Actual callers use Fernet, PBKDF2HMAC, AES/CBC and Ed25519 interfaces; no cipher or key format changed. Added encrypted credential reload and encrypted webhook round-trip tests. PyInstaller now explicitly collects PIL in the same desktop-runtime package loop as PDF/Office readers.

## Validation
Real PDF AES password rejection/success, text and metadata; image embedded in Office; encrypted credential reload and webhook AES; existing signature/security regression suites: 55 passed. New isolated environment against the updated parser/crypto versions: 6 passed. Python 3.10 and 3.12 desktop-runtime/document/database source combinations both resolve; the 3.10 resolver picks image parser 12.3.0, the 3.12 resolver picks 13.0.0. Framework execution under 3.10 remains blocked by its pre-existing datetime.UTC import, documented separately.
Actual PyInstaller `collect_all` found PIL's JPEG/PNG/_imaging modules, 18 image native libraries and PDF modules; SDK native module and offline pricing resource discovery also passed. This does not claim a complete frozen application build.
Official files were downloaded and SHA256-verified: PDF 6.21.4 = 33e4fb41ca352810eb4e9838aa0d82d6888a5f8bf682f43e99cce5faa666255c; image parser 13.0.0 arm64 CPython 3.12 wheel = fc481f742ccda20e9ed760b8f978dff50f2a4e9bc253ac167fb0a05b0783ef52.

Real Python 3.10 library-level probes passed PDF text/AES encryption and image-in-Office round trips with PDF 6.21.4 / image parser 12.3.0. This validates dependency compatibility only; the framework's existing Python 3.10 import defect remains.
