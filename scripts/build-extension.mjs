#!/usr/bin/env node
// SP6 · build the distributable extension artifacts (dual path — plan §1.4):
//
//   node scripts/build-extension.mjs [--key <pem>] [--out <dir>]
//
//   1. STORE zip  <out>/agx-bridge-<version>.zip — Chrome Web Store upload
//      format (manifest.json at the zip root). Built with the system `zip`
//      (macOS/Linux); pem keys and dist/ itself are excluded — a private key
//      must NEVER enter an artifact.
//   2. ENTERPRISE CRX3 <out>/agx-bridge-<version>.crx — self-hosted private
//      distribution. CRX3 container (magic "Cr24" v3) hand-encoded per
//      components/crx_file/crx3.proto (CrxFileHeader — cross-checked against
//      a Chrome --pack-extension reference artifact, see SP6 plan §5):
//        CrxFileHeader {
//          repeated AsymmetricKeyProof sha256_with_rsa = 2;  // {public_key, signature}
//          optional bytes signed_header_data = 10000;        // serialized SignedData
//        }
//        SignedData { optional bytes crx_id = 1; }           // 16 raw bytes
//      Proofs are RSASSA-PKCS1-v1_5-SHA256 over "CRX3 SignedData\x00" +
//      LE32(header size) + signed_header_data + archive (crx3.proto's "PSS"
//      comment is stale — algorithm confirmed against a reference CRX3 from
//      Chrome --pack-extension), signed via node:crypto — no openssl/Chrome
//      GUI dependency. The
//      signing key SHOULD be the same key that fixes the extension ID in
//      manifest.json (default: extension/test-extension-key.pem, gitignored),
//      so the CRX installs with the SAME ID the NM host registration allows.
//   3. ENTERPRISE update-manifest template <out>/updates.xml — for
//      ExtensionInstallForcelist self-hosted updates (codebase placeholder
//      to be pointed at the private file server).
//
// The script self-verifies: derived extension ID must match the manifest
// "key" ID, and the CRX3 signature must verify against the packaged header.
//
// Author: Damon Li

import { constants, createHash, createPublicKey, createSign, createVerify } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const extensionDir = path.join(repoRoot, "extension");

// --- CLI -------------------------------------------------------------------
const argv = process.argv.slice(2);
const keyArg = readFlag("--key");
const outArg = readFlag("--out");
const defaultOutDir = path.join(extensionDir, "dist");
const outDir = outArg ? path.resolve(outArg) : defaultOutDir;
const defaultKeyPath = path.join(extensionDir, "test-extension-key.pem");
const keyPath = keyArg ? path.resolve(keyArg) : defaultKeyPath;

function readFlag(name) {
  const index = argv.indexOf(name);
  if (index === -1) return null;
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    console.error(`ERROR: ${name} requires a value`);
    process.exit(2);
  }
  return value;
}

// --- inputs ------------------------------------------------------------------
const manifestPath = path.join(extensionDir, "manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const version = String(manifest.version);

if (!fs.existsSync(manifestPath)) {
  console.error(`ERROR: extension manifest not found: ${manifestPath}`);
  process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });

// --- 1. store zip ------------------------------------------------------------
const zipPath = path.join(outDir, `agx-bridge-${version}.zip`);
{
  const rel = path.relative(extensionDir, outDir);
  const excludes = [`${rel}/`, rel, "*.pem", ".DS_Store", "*/.DS_Store", "__MACOSX", "__MACOSX/*"]
    .flatMap((pattern) => ["-x", pattern]);
  // zip runs with cwd = extensionDir so the zip root IS the manifest dir
  // (Chrome Web Store upload format).
  execFileSync("zip", ["-r", "-X", "-q", zipPath, ".", ...excludes], { cwd: extensionDir });
  console.log(`[build-extension] store zip  ${zipPath}`);
}

// --- CRX3 helpers (crx3.proto, hand-encoded protobuf) -------------------------
// message CrxFileHeader {
//   repeated AsymmetricKeyProof sha256_with_rsa = 2;
//   optional bytes signed_header_data = 10000;   // serialized SignedData
// }
// message AsymmetricKeyProof { optional bytes public_key = 1; optional bytes signature = 2; }
// message SignedData { optional bytes crx_id = 1; }   // 16 raw bytes
function varint(value) {
  const bytes = [];
  let v = value;
  do {
    let byte = v & 0x7f;
    v = Math.floor(v / 128);
    if (v > 0) byte |= 0x80;
    bytes.push(byte);
  } while (v > 0);
  return Buffer.from(bytes);
}

function protobufBytesField(fieldNumber, payload) {
  return Buffer.concat([varint((fieldNumber << 3) | 2), varint(payload.length), payload]);
}

function encodeAsymmetricKeyProof(publicKey, signature) {
  return Buffer.concat([protobufBytesField(1, publicKey), protobufBytesField(2, signature)]);
}

function encodeCrxFileHeader(rsaProof, signedHeaderData) {
  return Buffer.concat([
    protobufBytesField(2, rsaProof), // sha256_with_rsa
    protobufBytesField(10000, signedHeaderData), // signed_header_data
  ]);
}

function encodeSignedData(crxIdBytes) {
  return protobufBytesField(1, crxIdBytes);
}

/**
 * The exact byte string every CRX3 proof is computed over, per crx3.proto:
 * "CRX3 SignedData\0" + LE32(signed_header_data size) + signed_header_data + archive.
 */
function crx3ProofPayload(signedHeaderData, archive) {
  const prefix = Buffer.from("CRX3 SignedData\x00", "utf8");
  return Buffer.concat([prefix, UINT32LE(signedHeaderData.length), signedHeaderData, archive]);
}

/** 16 raw bytes: first half of SHA256(public key DER). */
function crxIdBytesFromPublicKey(publicKeyDer) {
  return createHash("sha256").update(publicKeyDer).digest().subarray(0, 16);
}

/** Extension ID string (a-p nibbles) for the same key — update-manifest appid. */
function extensionIdFromPublicKey(publicKeyDer) {
  const digest = createHash("sha256").update(publicKeyDer).digest();
  let id = "";
  for (const byte of digest.subarray(0, 16)) {
    id += String.fromCharCode(0x61 + (byte >> 4)) + String.fromCharCode(0x61 + (byte & 0x0f));
  }
  return id;
}

function UINT32LE(value) {
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(value, 0);
  return buf;
}

/**
 * RSASSA-PKCS1-v1_5 with SHA-256 over the CRX3 SignedData payload — the
 * scheme Chrome actually verifies for sha256_with_rsa (crx3.proto's "PSS"
 * comment is stale; cross-validated against a Chrome --pack-extension
 * reference artifact, see SP6 plan §5).
 */
function signCrx3Proof(privateKeyPem, payload) {
  return createSign("RSA-SHA256")
    .update(payload)
    .sign({ key: privateKeyPem, padding: constants.RSA_PKCS1_PADDING });
}

function verifyCrx3Proof(publicKeyObj, payload, signature) {
  return createVerify("RSA-SHA256")
    .update(payload)
    .verify({ key: publicKeyObj, padding: constants.RSA_PKCS1_PADDING }, signature);
}

// --- 2. enterprise CRX3 -------------------------------------------------------
let crxPath = null;
if (fs.existsSync(keyPath)) {
  const privateKeyPem = fs.readFileSync(keyPath, "utf8");
  const publicKeyObj = createPublicKey(privateKeyPem);
  const publicKeyDer = publicKeyObj.export({ type: "spki", format: "der" });
  const crxIdBytes = crxIdBytesFromPublicKey(publicKeyDer);
  const extensionId = extensionIdFromPublicKey(publicKeyDer);

  // The manifest "key" field fixes the ID for unpacked installs; a CRX built
  // from this key must yield the SAME ID or the NM host allowed_origins
  // would stop matching.
  const manifestKeyB64 = manifest.key;
  if (manifestKeyB64) {
    const manifestId = extensionIdFromPublicKey(Buffer.from(manifestKeyB64, "base64"));
    if (manifestId !== extensionId) {
      console.error(
        `ERROR: signing key yields extension ID ${extensionId} but manifest "key" fixes ${manifestId} — use the matching private key.`,
      );
      process.exit(1);
    }
    console.log(`[build-extension] extension ID ${extensionId} (matches manifest "key")`);
  }

  // SignedData{crx_id} → proof over the CRX3 SignedData payload → header.
  const zipBytes = fs.readFileSync(zipPath);
  const signedHeaderData = encodeSignedData(crxIdBytes);
  const payload = crx3ProofPayload(signedHeaderData, zipBytes);
  const signature = signCrx3Proof(privateKeyPem, payload);
  const header = encodeCrxFileHeader(encodeAsymmetricKeyProof(publicKeyDer, signature), signedHeaderData);

  const crx = Buffer.concat([Buffer.from("Cr24", "ascii"), UINT32LE(3), UINT32LE(header.length), header, zipBytes]);
  crxPath = path.join(outDir, `agx-bridge-${version}.crx`);
  fs.writeFileSync(crxPath, crx);
  console.log(`[build-extension] crx3       ${crxPath} (${crx.length} bytes, header ${header.length})`);

  // Self-verify: layout + RSA-PSS proof over the canonical payload.
  const onDisk = fs.readFileSync(crxPath);
  if (onDisk.readUInt32LE(4) !== 3 || onDisk.readUInt32LE(8) !== header.length) {
    console.error("ERROR: CRX3 self-check failed (header layout)");
    process.exit(1);
  }
  const archive = onDisk.subarray(12 + header.length);
  if (!archive.equals(zipBytes)) {
    console.error("ERROR: CRX3 self-check failed (archive mismatch)");
    process.exit(1);
  }
  const ok = verifyCrx3Proof(publicKeyObj, crx3ProofPayload(signedHeaderData, archive), signature);
  if (!ok) {
    console.error("ERROR: CRX3 self-check failed (RSA signature does not verify)");
    process.exit(1);
  }
  console.log("[build-extension] CRX3 self-check OK (layout + RSASSA-PKCS1-v1_5-SHA256 proof over CRX3 SignedData payload)");
} else {
  console.log(
    `[build-extension] NOTE: signing key not found (${keyPath}) — store zip only. ` +
      "Pass --key <pem> to also build the enterprise CRX3 (use the key matching manifest \"key\").",
  );
}

// --- 3. enterprise update-manifest template ------------------------------------
const updateManifestPath = path.join(outDir, "updates.xml");
const extensionId = manifest.key
  ? extensionIdFromPublicKey(Buffer.from(manifest.key, "base64"))
  : "UNLOCKED-ID-SET-MANIFEST-KEY";
const updateXml = `<?xml version='1.0' encoding='UTF-8'?>
<gupdate xmlns='http://www.google.com/update2/response' protocol='2.0'>
  <app appid='${extensionId}'>
    <updatecheck codebase='https://INTERNAL-HOST.example.com/agx/agx-bridge-${version}.crx' version='${version}' />
  </app>
</gupdate>
`;
fs.writeFileSync(updateManifestPath, updateXml, "utf-8");
console.log(`[build-extension] updates    ${updateManifestPath} (edit codebase → your private file server)`);
