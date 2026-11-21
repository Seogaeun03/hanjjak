import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { MAX_QA_REPORT_IMAGE_BYTES } from "./qaReportApi";

it("keeps the nginx request limit above a base64 encoded maximum-size QA screenshot", () => {
  const nginx = readFileSync(resolve(process.cwd(), "nginx.conf"), "utf8");
  const configuredMegabytes = Number(nginx.match(/client_max_body_size\s+(\d+)m;/)?.[1]);
  const encodedBytes = Math.ceil(MAX_QA_REPORT_IMAGE_BYTES / 3) * 4;
  const jsonEnvelopeAllowance = 16 * 1024;

  expect(configuredMegabytes * 1024 * 1024).toBeGreaterThan(encodedBytes + jsonEnvelopeAllowance);
});
