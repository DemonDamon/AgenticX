#!/usr/bin/env node
/**
 * Local-only SAML IdP fixture.
 *
 * Provides two endpoints used by integration tests and manual SAML workflow checks:
 *
 *   GET  /metadata              -> SP-readable IdP metadata XML
 *   GET  /sso?...               -> auto-POST form back to ACS with a signed SAMLResponse
 *
 * The fixture loads a local-only RSA keypair from ./.fixture/idp-private.pem +
 * idp-cert.pem; generate it once via setup-keypair.sh. The keypair is never
 * checked into git and MUST NOT be reused for production.
 */

import { readFileSync, existsSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { SignedXml } from "xml-crypto";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(HERE, ".fixture");
const PRIVATE_KEY_PATH = join(FIXTURE_DIR, "idp-private.pem");
const CERT_PATH = join(FIXTURE_DIR, "idp-cert.pem");

const PORT = Number(process.env.MOCK_SAML_IDP_PORT ?? 4444);
const HOST = process.env.MOCK_SAML_IDP_HOST ?? "127.0.0.1";
const ENTITY_ID = process.env.MOCK_SAML_IDP_ENTITY_ID ?? `http://${HOST}:${PORT}/`;
const SSO_URL = `${ENTITY_ID.replace(/\/$/, "")}/sso`;
const METADATA_URL = `${ENTITY_ID.replace(/\/$/, "")}/metadata`;

if (!existsSync(PRIVATE_KEY_PATH) || !existsSync(CERT_PATH)) {
  console.error("[mock-saml-idp] missing keypair, run scripts/sso/mock-saml-idp/setup-keypair.sh first.");
  process.exit(1);
}

const privateKey = readFileSync(PRIVATE_KEY_PATH, "utf8");
const certificate = readFileSync(CERT_PATH, "utf8");
const certificateBody = certificate
  .replace(/-----BEGIN CERTIFICATE-----/g, "")
  .replace(/-----END CERTIFICATE-----/g, "")
  .replace(/\s+/g, "");

function sanitizeXmlText(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function generateSamlId(prefix = "_") {
  const random = Math.random().toString(16).slice(2);
  return `${prefix}${random}${Date.now().toString(16)}`;
}

function isoNow(offsetSeconds = 0) {
  return new Date(Date.now() + offsetSeconds * 1000).toISOString();
}

function buildAttribute(name, values) {
  const formatted = (Array.isArray(values) ? values : [values])
    .filter((v) => v !== undefined && v !== null)
    .map((v) => `<saml:AttributeValue xsi:type="xs:string">${sanitizeXmlText(v)}</saml:AttributeValue>`)
    .join("");
  return `<saml:Attribute Name="${sanitizeXmlText(name)}" NameFormat="urn:oasis:names:tc:SAML:2.0:attrname-format:basic">${formatted}</saml:Attribute>`;
}

function buildSamlResponse({
  audience,
  acsUrl,
  email,
  displayName,
  roles,
  inResponseTo,
}) {
  const responseId = generateSamlId("_resp_");
  const assertionId = generateSamlId("_assert_");
  const notBefore = isoNow(-60);
  const notOnOrAfter = isoNow(60 * 5);
  const issuedAt = isoNow();

  const attributes = [
    buildAttribute("email", email),
    displayName ? buildAttribute("displayName", displayName) : "",
    Array.isArray(roles) && roles.length ? buildAttribute("roles", roles) : "",
  ]
    .filter(Boolean)
    .join("");

  const inResponseToAttr = inResponseTo ? ` InResponseTo="${sanitizeXmlText(inResponseTo)}"` : "";

  const assertion = `<saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xs="http://www.w3.org/2001/XMLSchema" ID="${assertionId}" IssueInstant="${issuedAt}" Version="2.0">` +
    `<saml:Issuer>${sanitizeXmlText(ENTITY_ID)}</saml:Issuer>` +
    `<saml:Subject>` +
    `<saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">${sanitizeXmlText(email)}</saml:NameID>` +
    `<saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer">` +
    `<saml:SubjectConfirmationData NotOnOrAfter="${notOnOrAfter}" Recipient="${sanitizeXmlText(acsUrl)}"${inResponseToAttr}/>` +
    `</saml:SubjectConfirmation>` +
    `</saml:Subject>` +
    `<saml:Conditions NotBefore="${notBefore}" NotOnOrAfter="${notOnOrAfter}">` +
    `<saml:AudienceRestriction><saml:Audience>${sanitizeXmlText(audience)}</saml:Audience></saml:AudienceRestriction>` +
    `</saml:Conditions>` +
    `<saml:AttributeStatement>${attributes}</saml:AttributeStatement>` +
    `</saml:Assertion>`;

  const sig = new SignedXml({ privateKey });
  sig.signatureAlgorithm = "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256";
  sig.canonicalizationAlgorithm = "http://www.w3.org/2001/10/xml-exc-c14n#";
  sig.addReference({
    xpath: `//*[local-name(.)='Assertion']`,
    digestAlgorithm: "http://www.w3.org/2001/04/xmlenc#sha256",
    transforms: [
      "http://www.w3.org/2000/09/xmldsig#enveloped-signature",
      "http://www.w3.org/2001/10/xml-exc-c14n#",
    ],
  });
  sig.getKeyInfoContent = () => `<X509Data><X509Certificate>${certificateBody}</X509Certificate></X509Data>`;
  sig.computeSignature(assertion, {
    location: { reference: `//*[local-name(.)='Assertion']/*[local-name(.)='Issuer']`, action: "after" },
  });
  const signedAssertion = sig.getSignedXml();

  const response = `<?xml version="1.0" encoding="UTF-8"?>` +
    `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${responseId}" Destination="${sanitizeXmlText(acsUrl)}" Version="2.0" IssueInstant="${issuedAt}"${inResponseToAttr}>` +
    `<saml:Issuer>${sanitizeXmlText(ENTITY_ID)}</saml:Issuer>` +
    `<samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>` +
    signedAssertion +
    `</samlp:Response>`;
  return response;
}

function buildMetadata() {
  return `<?xml version="1.0" encoding="UTF-8"?>` +
    `<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata" entityID="${sanitizeXmlText(ENTITY_ID)}">` +
    `<md:IDPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">` +
    `<md:KeyDescriptor use="signing">` +
    `<KeyInfo xmlns="http://www.w3.org/2000/09/xmldsig#"><X509Data><X509Certificate>${certificateBody}</X509Certificate></X509Data></KeyInfo>` +
    `</md:KeyDescriptor>` +
    `<md:SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="${sanitizeXmlText(SSO_URL)}"/>` +
    `<md:SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="${sanitizeXmlText(SSO_URL)}"/>` +
    `</md:IDPSSODescriptor>` +
    `</md:EntityDescriptor>`;
}

function readQuery(reqUrl) {
  const url = new URL(reqUrl, ENTITY_ID);
  return Object.fromEntries(url.searchParams.entries());
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", ENTITY_ID);
  if (req.method === "GET" && url.pathname === "/metadata") {
    const xml = buildMetadata();
    res.writeHead(200, { "content-type": "application/samlmetadata+xml" });
    res.end(xml);
    return;
  }
  if (req.method === "GET" && url.pathname === "/sso") {
    const params = readQuery(req.url ?? "/");
    const acsUrl = params.acs;
    const audience = params.audience;
    const email = params.email ?? "alice@example.com";
    const displayName = params.displayName;
    const roles = params.roles ? params.roles.split(",").filter(Boolean) : ["member"];
    const relayState = params.RelayState ?? params.relayState ?? "";
    const inResponseTo = params.inResponseTo;
    if (!acsUrl || !audience) {
      res.writeHead(400, { "content-type": "text/plain" });
      res.end("acs and audience query parameters are required");
      return;
    }
    const samlResponseXml = buildSamlResponse({ audience, acsUrl, email, displayName, roles, inResponseTo });
    const samlResponseB64 = Buffer.from(samlResponseXml, "utf8").toString("base64");
    const html = `<!doctype html><html><body onload="document.forms[0].submit()"><form method="POST" action="${sanitizeXmlText(acsUrl)}"><input type="hidden" name="SAMLResponse" value="${sanitizeXmlText(samlResponseB64)}"/><input type="hidden" name="RelayState" value="${sanitizeXmlText(relayState)}"/><noscript><button type="submit">Continue</button></noscript></form></body></html>`;
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(html);
    return;
  }
  res.writeHead(404, { "content-type": "text/plain" });
  res.end("not found");
});

server.listen(PORT, HOST, () => {
  console.log(`[mock-saml-idp] listening on http://${HOST}:${PORT}`);
  console.log(`[mock-saml-idp] entityID=${ENTITY_ID}`);
  console.log(`[mock-saml-idp] metadata=${METADATA_URL}`);
  console.log(`[mock-saml-idp] sso=${SSO_URL}?acs=<your-acs>&audience=<sp-entity-id>&email=alice@example.com&RelayState=<state>`);
});
