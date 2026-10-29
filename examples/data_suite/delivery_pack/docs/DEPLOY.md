# Delivery Pack — Deploy checklist (synthetic)

1. Install AgenticX with Data Suite deps (same env as golden-path).
2. Point `AGX_DATA_SUITE_STORE_DIR` at a writable directory for dictionary/boards persistence.
3. Apply pack:
   ```bash
   python examples/data_suite/delivery_pack/apply.py
   # or: python examples/data_suite/delivery_pack/apply.py /path/to/your-b-pack
   ```
4. Confirm stdout `RegisterReport` counts (channels ≥ 2, dictionary fields ≥ 1, boards ≥ 1).
5. Admin console (optional): open Data Governance / Data Boards and verify upserted rows.
6. IAM: configure real OIDC/SAML in the **separate B repo**; keep secrets out of AgenticX.
7. Do **not** open A9 compute; keep compute on the customer side.
