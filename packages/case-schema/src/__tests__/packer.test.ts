import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  packCase,
  unpackCase,
  readArchiveManifest,
  verifyArchive,
} from "../packer.js";
import {
  mkdtempSync,
  rmSync,
  cpSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import AdmZip from "adm-zip";

describe("packCase / unpackCase / verifyArchive", () => {
  let tempDir: string;
  let validCaseDir: string;
  let outputDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "uwbench-packer-"));
    validCaseDir = join(tempDir, "valid-case");
    outputDir = join(tempDir, "output");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  function copyValidCase() {
    const fixtureDir = join(
      __dirname,
      "..",
      "..",
      "__fixtures__",
      "packer",
      "valid-case",
    );
    cpSync(fixtureDir, validCaseDir, { recursive: true });
    mkdirSync(outputDir, { recursive: true });
  }

  describe("packCase - input archives", () => {
    it("creates a deterministic input archive for reasoning_only lane", async () => {
      copyValidCase();
      const archivePath = join(outputDir, "case-00001.input.uwb");

      const result = await packCase(validCaseDir, {
        role: "input",
        lane: "reasoning_only",
        outputPath: archivePath,
      });

      expect(result.success).toBe(true);
      expect(result.archivePath).toBe(archivePath);
      expect(result.manifest).toBeDefined();
      expect(result.manifest?.role).toBe("input");
      expect(result.manifest?.lane).toBe("reasoning_only");
      expect(result.manifest?.caseId).toBe("case-00001");
      expect(result.manifest?.entries.length).toBeGreaterThan(0);
    });

    it("creates a deterministic input archive for raw_documents lane", async () => {
      copyValidCase();
      const archivePath = join(outputDir, "case-00001.raw_documents.uwb");

      const result = await packCase(validCaseDir, {
        role: "input",
        lane: "raw_documents",
        outputPath: archivePath,
      });

      expect(result.success).toBe(true);
      expect(result.manifest?.lane).toBe("raw_documents");
      const normalizedEntry = result.manifest?.entries.find(
        (e) => e.path === "normalized/canonical-input.json",
      );
      expect(normalizedEntry).toBeUndefined();
    });

    it("creates a deterministic input archive for normalized_data lane", async () => {
      copyValidCase();
      const archivePath = join(outputDir, "case-00001.normalized_data.uwb");

      const result = await packCase(validCaseDir, {
        role: "input",
        lane: "normalized_data",
        outputPath: archivePath,
      });

      expect(result.success).toBe(true);
      expect(result.manifest?.lane).toBe("normalized_data");
      const normalizedEntry = result.manifest?.entries.find(
        (e) => e.path === "normalized/canonical-input.json",
      );
      expect(normalizedEntry).toBeDefined();
      expect(normalizedEntry?.role).toBe("normalized");
    });

    it("produces byte-identical archives for identical inputs", async () => {
      copyValidCase();
      const archivePath1 = join(outputDir, "case-00001.a.uwb");
      const archivePath2 = join(outputDir, "case-00001.b.uwb");

      const result1 = await packCase(validCaseDir, {
        role: "input",
        lane: "reasoning_only",
        outputPath: archivePath1,
      });
      const result2 = await packCase(validCaseDir, {
        role: "input",
        lane: "reasoning_only",
        outputPath: archivePath2,
      });

      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);

      const content1 = readFileSync(archivePath1);
      const content2 = readFileSync(archivePath2);
      expect(content1).toEqual(content2);
    });

    it("includes SHA-256, size, mediaType, role, and lane for every entry", async () => {
      copyValidCase();
      const archivePath = join(outputDir, "case-00001.input.uwb");

      const result = await packCase(validCaseDir, {
        role: "input",
        lane: "reasoning_only",
        outputPath: archivePath,
      });

      expect(result.success).toBe(true);
      for (const entry of result.manifest!.entries) {
        expect(entry.sha256).toMatch(/^[a-f0-9]{64}$/);
        expect(entry.size).toBeGreaterThanOrEqual(0);
        expect(entry.mediaType).toBeTruthy();
        expect(entry.role).toBeTruthy();
        expect(entry.lane).toBe("reasoning_only");
      }
    });

    it("includes core files in input archive", async () => {
      copyValidCase();
      const archivePath = join(outputDir, "case-00001.input.uwb");

      const result = await packCase(validCaseDir, {
        role: "input",
        lane: "reasoning_only",
        outputPath: archivePath,
      });

      const paths = result.manifest!.entries.map((e) => e.path);
      expect(paths).toContain("case.yaml");
      expect(paths).toContain("task.md");
      expect(paths).toContain("environment/scenario.yaml");
      expect(paths).toContain("normalized/canonical-input.json");
      expect(paths).not.toContain("environment/tool-fixtures.json");
    });

    it("enforces disjoint participant-visible lane projections", async () => {
      copyValidCase();
      const manifests = await Promise.all(
        (["raw_documents", "normalized_data", "reasoning_only"] as const).map(
          async (lane) =>
            (
              await packCase(validCaseDir, {
                role: "input",
                lane,
                outputPath: join(outputDir, `${lane}.uwb`),
              })
            ).manifest!,
        ),
      );
      const [raw, normalized, reasoning] = manifests.map(
        (manifest) => new Set(manifest.entries.map((entry) => entry.path)),
      );
      expect(
        [...raw!].some((path) => path.startsWith("inputs/documents/")),
      ).toBe(true);
      expect([...raw!].some((path) => path.startsWith("inputs/records/"))).toBe(
        false,
      );
      expect(raw!.has("normalized/canonical-input.json")).toBe(false);
      expect(normalized!.has("normalized/canonical-input.json")).toBe(true);
      expect(
        [...normalized!].some((path) => path.startsWith("inputs/documents/")),
      ).toBe(false);
      expect(reasoning!.has("normalized/canonical-input.json")).toBe(true);
      expect([...reasoning!].some((path) => path.startsWith("inputs/"))).toBe(
        false,
      );
      for (const paths of [raw!, normalized!, reasoning!]) {
        expect(paths.has("environment/tool-fixtures.json")).toBe(false);
        expect([...paths].some((path) => path.startsWith("private/"))).toBe(
          false,
        );
      }
    });

    it("rejects unsupported lane", async () => {
      copyValidCase();
      const archivePath = join(outputDir, "case-00001.input.uwb");

      const caseYamlPath = join(validCaseDir, "case.yaml");
      const caseYaml = readFileSync(caseYamlPath, "utf-8");
      const modifiedYaml = caseYaml.replace(
        "supported_lanes:\n  - raw_documents\n  - normalized_data\n  - reasoning_only",
        "supported_lanes:\n  - raw_documents",
      );
      writeFileSync(caseYamlPath, modifiedYaml);

      const result = await packCase(validCaseDir, {
        role: "input",
        lane: "reasoning_only",
        outputPath: archivePath,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Case validation failed");
      expect(
        result.diagnostics?.some((d) => d.code === "PACK.UNSUPPORTED_LANE"),
      ).toBe(true);
    });
  });

  describe("packCase - reference archives", () => {
    it("creates a reference archive with private files", async () => {
      copyValidCase();
      const archivePath = join(outputDir, "case-00001.reference.uwb");

      const result = await packCase(validCaseDir, {
        role: "reference",
        lane: "reasoning_only",
        outputPath: archivePath,
      });

      expect(result.success).toBe(true);
      expect(result.manifest?.role).toBe("reference");
      expect(result.manifest?.lane).toBe("reasoning_only");

      const paths = result.manifest!.entries.map((e) => e.path);
      expect(paths).toContain("private/expected-spread.json");
      expect(paths).toContain("private/expected-facts.json");
      expect(paths).toContain("private/expected-risks.json");
      expect(paths).toContain("private/expected-policy.json");
      expect(paths).toContain("private/expected-followups.json");
      expect(paths).toContain("private/decision-utility.json");
      expect(paths).toContain("private/citation-index.json");
      expect(paths).toContain("private/reviewer-annotations.json");
      expect(paths).toContain("private/adjudication-notes.md");
    });

    it("produces byte-identical reference archives for identical inputs", async () => {
      copyValidCase();
      const archivePath1 = join(outputDir, "case-00001.ref.a.uwb");
      const archivePath2 = join(outputDir, "case-00001.ref.b.uwb");

      const result1 = await packCase(validCaseDir, {
        role: "reference",
        lane: "reasoning_only",
        outputPath: archivePath1,
      });
      const result2 = await packCase(validCaseDir, {
        role: "reference",
        lane: "reasoning_only",
        outputPath: archivePath2,
      });

      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);

      const content1 = readFileSync(archivePath1);
      const content2 = readFileSync(archivePath2);
      expect(content1).toEqual(content2);
    });

    it("rejects when private directory is missing", async () => {
      copyValidCase();
      rmSync(join(validCaseDir, "private"), { recursive: true, force: true });

      const archivePath = join(outputDir, "case-00001.reference.uwb");
      const result = await packCase(validCaseDir, {
        role: "reference",
        lane: "reasoning_only",
        outputPath: archivePath,
      });

      expect(result.success).toBe(false);
      expect(
        result.diagnostics?.some((d) => d.code === "PACK.MISSING_PRIVATE_DIR"),
      ).toBe(true);
    });
  });

  describe("readArchiveManifest", () => {
    it("reads and validates manifest from archive", async () => {
      copyValidCase();
      const archivePath = join(outputDir, "case-00001.input.uwb");
      await packCase(validCaseDir, {
        role: "input",
        lane: "reasoning_only",
        outputPath: archivePath,
      });

      const verified = readArchiveManifest(archivePath);
      expect(verified.manifest.schemaVersion).toBe("1.0");
      expect(verified.manifest.caseId).toBe("case-00001");
      expect(verified.manifest.role).toBe("input");
      expect(verified.manifest.lane).toBe("reasoning_only");
      expect(verified.manifest.entries.length).toBeGreaterThan(0);
    });

    it("throws on missing manifest.json", () => {
      const zip = new AdmZip();
      zip.addFile("test.txt", Buffer.from("test"), "", 0o644);
      const archivePath = join(outputDir, "no-manifest.uwb");
      zip.writeZip(archivePath);

      expect(() => readArchiveManifest(archivePath)).toThrow(
        "Archive missing manifest.json",
      );
    });

    it("throws on invalid manifest schema", () => {
      const zip = new AdmZip();
      zip.addFile("manifest.json", Buffer.from('{"invalid": true}'), "", 0o644);
      const archivePath = join(outputDir, "invalid-manifest.uwb");
      zip.writeZip(archivePath);

      expect(() => readArchiveManifest(archivePath)).toThrow(
        "Invalid manifest",
      );
    });
  });

  describe("verifyArchive", () => {
    it("verifies a valid archive", async () => {
      copyValidCase();
      const archivePath = join(outputDir, "case-00001.input.uwb");
      await packCase(validCaseDir, {
        role: "input",
        lane: "reasoning_only",
        outputPath: archivePath,
      });

      const result = verifyArchive(archivePath);
      expect(result.valid).toBe(true);
      expect(result.manifest).toBeDefined();
      expect(result.errors).toHaveLength(0);
    });

    it("detects hash mismatch", async () => {
      copyValidCase();
      const archivePath = join(outputDir, "case-00001.input.uwb");
      await packCase(validCaseDir, {
        role: "input",
        lane: "reasoning_only",
        outputPath: archivePath,
      });

      const zip = new AdmZip(archivePath);
      const newZip = new AdmZip();
      for (const e of zip.getEntries()) {
        if (e.entryName === "case.yaml") {
          newZip.addFile(e.entryName, Buffer.from("corrupted"), "", 0o644);
        } else {
          newZip.addFile(e.entryName, e.getData(), "", 0o644);
        }
      }
      newZip.writeZip(archivePath);

      const result = verifyArchive(archivePath);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("Hash mismatch"))).toBe(true);
    });

    it("detects missing entry", async () => {
      copyValidCase();
      const archivePath = join(outputDir, "case-00001.input.uwb");
      await packCase(validCaseDir, {
        role: "input",
        lane: "reasoning_only",
        outputPath: archivePath,
      });

      const zip = new AdmZip(archivePath);
      const manifestEntry = zip.getEntry("manifest.json");
      if (!manifestEntry) {
        throw new Error("manifest.json not found in archive");
      }
      const manifest = JSON.parse(manifestEntry.getData().toString("utf-8"));
      // Keep manifest entries but remove a file from ZIP
      const fileToRemove = manifest.entries[manifest.entries.length - 1].path;

      const newZip = new AdmZip();
      for (const e of zip.getEntries()) {
        if (e.entryName === "manifest.json") {
          newZip.addFile(
            e.entryName,
            Buffer.from(JSON.stringify(manifest, null, 0)),
            "",
            0o644,
          );
        } else if (e.entryName !== fileToRemove) {
          newZip.addFile(e.entryName, e.getData(), "", 0o644);
        }
      }
      newZip.writeZip(archivePath);

      const result = verifyArchive(archivePath);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("Missing entry"))).toBe(true);
    });
  });

  describe("unpackCase", () => {
    it("unpacks a valid input archive", async () => {
      copyValidCase();
      const archivePath = join(outputDir, "case-00001.input.uwb");
      await packCase(validCaseDir, {
        role: "input",
        lane: "reasoning_only",
        outputPath: archivePath,
      });

      const result = unpackCase(archivePath, outputDir);
      expect(result.success).toBe(true);
      expect(result.outputDir).toBe(outputDir);
      expect(result.manifest).toBeDefined();
    });

    it("unpacks a valid reference archive", async () => {
      copyValidCase();
      const archivePath = join(outputDir, "case-00001.reference.uwb");
      await packCase(validCaseDir, {
        role: "reference",
        lane: "reasoning_only",
        outputPath: archivePath,
      });

      const result = unpackCase(archivePath, outputDir);
      expect(result.success).toBe(true);
    });

    it("verifies manifest and payload integrity before returning data", async () => {
      copyValidCase();
      const archivePath = join(outputDir, "case-00001.input.uwb");
      await packCase(validCaseDir, {
        role: "input",
        lane: "reasoning_only",
        outputPath: archivePath,
      });

      const zip = new AdmZip(archivePath);
      const newZip = new AdmZip();
      for (const e of zip.getEntries()) {
        if (e.entryName === "case.yaml") {
          newZip.addFile(e.entryName, Buffer.from("corrupted"), "", 0o644);
        } else {
          newZip.addFile(e.entryName, e.getData(), "", 0o644);
        }
      }
      newZip.writeZip(archivePath);

      const result = unpackCase(archivePath, outputDir, { verifyHashes: true });
      expect(result.success).toBe(false);
      expect(result.error).toBe("Archive hash verification failed");
    });

    it("rejects traversal paths in archive", () => {
      const zip = new AdmZip();
      const manifest = {
        schemaVersion: "1.0",
        archiveId: "test",
        caseId: "case-00001",
        role: "input" as const,
        lane: "reasoning_only" as const,
        createdAt: new Date().toISOString(),
        entries: [
          {
            path: "../traversal.txt",
            role: "case" as const,
            lane: "reasoning_only" as const,
            sha256: "a".repeat(64),
            size: 10,
            mediaType: "text/plain",
          },
        ],
        totalSize: 10,
        totalEntries: 1,
      };
      zip.addFile(
        "manifest.json",
        Buffer.from(JSON.stringify(manifest, null, 0)),
        "",
        0o644,
      );
      zip.addFile("../traversal.txt", Buffer.from("traversal"), "", 0o644);
      const archivePath = join(outputDir, "traversal.uwb");
      zip.writeZip(archivePath);

      const result = unpackCase(archivePath, outputDir);
      expect(result.success).toBe(false);
      expect(result.error).toBe("Archive contains unsafe paths");
      expect(
        result.diagnostics?.some((d) => d.code === "UNPACK.UNSAFE_PATH"),
      ).toBe(true);
    });

    it("rejects absolute paths in archive", () => {
      const zip = new AdmZip();
      const manifest = {
        schemaVersion: "1.0",
        archiveId: "test",
        caseId: "case-00001",
        role: "input" as const,
        lane: "reasoning_only" as const,
        createdAt: new Date().toISOString(),
        entries: [
          {
            path: "/absolute/path.txt",
            role: "case" as const,
            lane: "reasoning_only" as const,
            sha256: "a".repeat(64),
            size: 10,
            mediaType: "text/plain",
          },
        ],
        totalSize: 10,
        totalEntries: 1,
      };
      zip.addFile(
        "manifest.json",
        Buffer.from(JSON.stringify(manifest, null, 0)),
        "",
        0o644,
      );
      zip.addFile("/absolute/path.txt", Buffer.from("absolute"), "", 0o644);
      const archivePath = join(outputDir, "absolute.uwb");
      zip.writeZip(archivePath);

      const result = unpackCase(archivePath, outputDir);
      expect(result.success).toBe(false);
      expect(result.error).toBe("Archive contains unsafe paths");
    });

    it("rejects duplicate entries in archive", () => {
      const zip = new AdmZip();
      const manifest = {
        schemaVersion: "1.0",
        archiveId: "test",
        caseId: "case-00001",
        role: "input" as const,
        lane: "reasoning_only" as const,
        createdAt: new Date().toISOString(),
        entries: [
          {
            path: "duplicate.txt",
            role: "case" as const,
            lane: "reasoning_only" as const,
            sha256: "a".repeat(64),
            size: 10,
            mediaType: "text/plain",
          },
          {
            path: "duplicate.txt",
            role: "task" as const,
            lane: "reasoning_only" as const,
            sha256: "b".repeat(64),
            size: 10,
            mediaType: "text/plain",
          },
        ],
        totalSize: 20,
        totalEntries: 2,
      };
      zip.addFile(
        "manifest.json",
        Buffer.from(JSON.stringify(manifest, null, 0)),
        "",
        0o644,
      );
      zip.addFile("duplicate.txt", Buffer.from("content1"), "", 0o644);
      const archivePath = join(outputDir, "duplicate.uwb");
      zip.writeZip(archivePath);

      const result = unpackCase(archivePath, outputDir);
      expect(result.success).toBe(false);
      expect(result.error).toBe("Archive contains unsafe paths");
    });

    it("validates expected role, lane, and caseId", async () => {
      copyValidCase();
      const archivePath = join(outputDir, "case-00001.input.uwb");
      await packCase(validCaseDir, {
        role: "input",
        lane: "reasoning_only",
        outputPath: archivePath,
      });

      const result1 = unpackCase(archivePath, outputDir, {
        expectedRole: "reference",
      });
      expect(result1.success).toBe(false);
      expect(
        result1.diagnostics?.some((d) => d.code === "UNPACK.ROLE_MISMATCH"),
      ).toBe(true);

      const result2 = unpackCase(archivePath, outputDir, {
        expectedLane: "raw_documents",
      });
      expect(result2.success).toBe(false);
      expect(
        result2.diagnostics?.some((d) => d.code === "UNPACK.LANE_MISMATCH"),
      ).toBe(true);

      const result3 = unpackCase(archivePath, outputDir, {
        expectedCaseId: "case-99999",
      });
      expect(result3.success).toBe(false);
      expect(
        result3.diagnostics?.some((d) => d.code === "UNPACK.CASE_ID_MISMATCH"),
      ).toBe(true);
    });

    it("can skip hash verification", async () => {
      copyValidCase();
      const archivePath = join(outputDir, "case-00001.input.uwb");
      await packCase(validCaseDir, {
        role: "input",
        lane: "reasoning_only",
        outputPath: archivePath,
      });

      const zip = new AdmZip(archivePath);
      const newZip = new AdmZip();
      for (const e of zip.getEntries()) {
        if (e.entryName === "case.yaml") {
          newZip.addFile(e.entryName, Buffer.from("corrupted"), "", 0o644);
        } else {
          newZip.addFile(e.entryName, e.getData(), "", 0o644);
        }
      }
      newZip.writeZip(archivePath);

      const result1 = unpackCase(archivePath, outputDir, {
        verifyHashes: true,
      });
      expect(result1.success).toBe(false);

      const result2 = unpackCase(archivePath, outputDir, {
        verifyHashes: false,
      });
      expect(result2.success).toBe(true);
    });

    it("extracts all files with correct content", async () => {
      copyValidCase();
      const archivePath = join(outputDir, "case-00001.input.uwb");
      await packCase(validCaseDir, {
        role: "input",
        lane: "reasoning_only",
        outputPath: archivePath,
      });

      const result = unpackCase(archivePath, outputDir);
      expect(result.success).toBe(true);

      expect(existsSync(join(outputDir, "case.yaml"))).toBe(true);
      expect(existsSync(join(outputDir, "task.md"))).toBe(true);
      expect(
        existsSync(join(outputDir, "environment/tool-fixtures.json")),
      ).toBe(false);
      expect(
        existsSync(join(outputDir, "inputs/documents/financial_statement.pdf")),
      ).toBe(false);
      expect(
        existsSync(join(outputDir, "normalized/canonical-input.json")),
      ).toBe(true);

      const caseYaml = readFileSync(join(outputDir, "case.yaml"), "utf-8");
      expect(caseYaml).toContain("case-00001");
    });
  });

  describe("deterministic archive creation", () => {
    it("produces identical archives across multiple runs", async () => {
      copyValidCase();
      const archives: Buffer[] = [];

      for (let i = 0; i < 5; i++) {
        const archivePath = join(outputDir, `case-00001.${i}.uwb`);
        const result = await packCase(validCaseDir, {
          role: "input",
          lane: "reasoning_only",
          outputPath: archivePath,
        });
        expect(result.success).toBe(true);
        archives.push(readFileSync(archivePath));
      }

      for (let i = 1; i < archives.length; i++) {
        expect(archives[i]).toEqual(archives[0]);
      }
    });

    it("produces identical reference archives across multiple runs", async () => {
      copyValidCase();
      const archives: Buffer[] = [];

      for (let i = 0; i < 5; i++) {
        const archivePath = join(outputDir, `case-00001.ref.${i}.uwb`);
        const result = await packCase(validCaseDir, {
          role: "reference",
          lane: "reasoning_only",
          outputPath: archivePath,
        });
        expect(result.success).toBe(true);
        archives.push(readFileSync(archivePath));
      }

      for (let i = 1; i < archives.length; i++) {
        expect(archives[i]).toEqual(archives[0]);
      }
    });

    it("entries are sorted deterministically in manifest", async () => {
      copyValidCase();
      const archivePath = join(outputDir, "case-00001.input.uwb");
      const result = await packCase(validCaseDir, {
        role: "input",
        lane: "reasoning_only",
        outputPath: archivePath,
      });

      const paths = result.manifest!.entries.map((e) => e.path);
      const sortedPaths = [...paths].sort();
      expect(paths).toEqual(sortedPaths);
    });
  });
});
