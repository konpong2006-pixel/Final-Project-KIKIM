"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.receiptDedupeKeys = receiptDedupeKeys;
const node_crypto_1 = require("node:crypto");
/** Exact evidence only: matching amounts/times alone may be different purchases. */
function receiptDedupeKeys(input) {
    const normalize = (value) => value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
    const reference = normalize(input.reference);
    const merchant = normalize(input.merchant);
    const day = new Date(input.occurredAt.getTime() + 7 * 3600000).toISOString().slice(0, 10);
    const keys = [`scan:${input.scanId}`];
    if (/^[a-f0-9]{64}$/.test(input.sourceImageHash))
        keys.push(`image:${input.sourceImageHash}`);
    // A short receipt number is routinely reused. Require a useful reference,
    // issuer and date; do not collapse unknown merchants or guessed amounts.
    if (reference.length >= 6 && /\d/.test(reference) && merchant && !/ไม่ระบุ|unknown/.test(merchant)) {
        keys.push(`reference:${merchant}:${day}:${reference}`);
    }
    return keys.map((key) => (0, node_crypto_1.createHash)("sha256").update(key).digest("hex"));
}
//# sourceMappingURL=receipt-dedupe.js.map