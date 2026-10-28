# Delivery Pack Skeleton (B layer template)

Synthetic **Brand-A / Market-X** pack used to exercise A-layer `register_pack()`.

## A / B boundary

| Lives here (AgenticX example) | Lives in a separate B repo |
|-------------------------------|----------------------------|
| Pack layout + loader contract | Real company names, systems, wide tables |
| FakeChannel seed rows | JDBC/Kafka credentials & private endpoints |
| Desensitized dictionary/tags/boards | Production tag lists & board KPIs |
| IAM strategy **shape** only | Real AuthStrategy + secrets |

## Copy to a B repository

```bash
cp -R examples/data_suite/delivery_pack /path/to/agx-data-suite-<project>-pack
# then replace Brand-A / Market-X with project-local codes (still avoid committing secrets)
```

## Desensitize rules

- No real company, proposal title, product-line codename, or internal platform name.
- No tokens, passwords, private hostnames that identify a customer.
- Prefer `example.com` / `example.invalid` for endpoints.

## Apply

```bash
python examples/data_suite/delivery_pack/apply.py
```
