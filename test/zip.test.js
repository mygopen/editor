import assert from "node:assert/strict";
import { test } from "node:test";
import { createStoredZip } from "../src/zip.js";

test("createStoredZip emits a valid stored zip structure", () => {
  const zip = createStoredZip([
    { name: "image-01.png", data: Buffer.from("png-bytes") },
    { name: "image-02.jpg", data: Buffer.from("jpg-bytes") }
  ]);

  assert.equal(zip.readUInt32LE(0), 0x04034b50);
  assert.equal(zip.includes(Buffer.from("image-01.png")), true);
  assert.equal(zip.includes(Buffer.from("image-02.jpg")), true);

  const endRecordOffset = zip.byteLength - 22;
  assert.equal(zip.readUInt32LE(endRecordOffset), 0x06054b50);
  assert.equal(zip.readUInt16LE(endRecordOffset + 8), 2);
  assert.equal(zip.readUInt16LE(endRecordOffset + 10), 2);
});
