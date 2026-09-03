import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CONSTRUCT } from "./construct.js";
import {
  bundledLoabOriginationSample,
  classifyLoabTask,
  loadLoabTasks,
} from "./loab/load.js";
import { mapLoabTask } from "./loab/map.js";
import {
  extractLoabOutcome,
  mapProductDecisionToLoabOutcome,
  scoreLoabOutcome,
} from "./loab/score.js";

describe("LOAB mapping", () => {
  it("maps origination credit-file facts and refuses KYC/servicing tasks", () => {
    expect(classifyLoabTask("origination/task-01").mapped).toBe(true);
    expect(classifyLoabTask("origination/task-06").mapped).toBe(false);
    expect(classifyLoabTask("origination/task-06").exclusionReason).toMatch(
      /SAR|KYC/i,
    );
    expect(classifyLoabTask("servicing/task-01").mapped).toBe(false);
    expect(classifyLoabTask("collections/task-01").mapped).toBe(false);
    expect(classifyLoabTask("compliance/task-01").mapped).toBe(false);
  });

  it("builds a memo-path run request without LOAB process tools", () => {
    const mapped = mapLoabTask(bundledLoabOriginationSample());
    expect(mapped.constructMismatch).toBe(CONSTRUCT.loab.mismatch);
    expect(mapped.runRequest.benchmark).toBe("loab");
    expect(mapped.runRequest.caseId).toBe("loab-origination-task-01");
    expect(mapped.runRequest.objective).toMatch(/Do not perform AU KYC/);
    const uploaded = mapped.fixtures.documents.find(
      (document) => document.fileName === "loab-credit-file.json",
    );
    expect(uploaded?.content).not.toMatch(
      /"greenid_verify"|"equifax_pull"|"submit_sar"|"issue_notice"/,
    );
    expect(mapped.fixtures.records[0]?.record["legal_name"]).toBe(
      "Sarah Jane Mitchell",
    );
  });

  it("throws if asked to map a fraud/SAR or servicing task", () => {
    expect(() =>
      mapLoabTask({
        ...bundledLoabOriginationSample(),
        taskId: "origination/task-06",
        mapped: false,
        expectedDecision: "COMPLIANT",
      }),
    ).toThrow(/SAR|KYC/);
  });

  it("loads public origination tasks from a LOAB clone and skips excluded ones", () => {
    const root = "/tmp/public-benches/loab";
    if (!existsSync(`${root}/loab/tasks/origination/task-01/rubric.json`)) {
      return;
    }
    const tasks = loadLoabTasks({ root });
    expect(tasks.map((task) => task.taskId)).toEqual([
      "origination/task-01",
      "origination/task-02",
      "origination/task-03",
      "origination/task-04",
      "origination/task-05",
    ]);
    expect(tasks.every((task) => task.mapped)).toBe(true);
    const approve = tasks.find((task) => task.taskId === "origination/task-01");
    expect(approve?.expectedDecision).toBe("APPROVE");
    expect(approve?.profile?.personal["full_name"]).toBe("Sarah Jane Mitchell");
    const declined = tasks.filter(
      (task) => task.expectedDecision === "DECLINE",
    );
    expect(declined.map((task) => task.taskId)).toEqual([
      "origination/task-03",
      "origination/task-04",
      "origination/task-05",
    ]);
  });
});

describe("LOAB outcome-only scoring", () => {
  it("maps product decisions onto LOAB outcomes and leaves process unscored", () => {
    expect(mapProductDecisionToLoabOutcome("APPROVE_WITH_CONDITIONS")).toBe(
      "APPROVE",
    );
    expect(mapProductDecisionToLoabOutcome("INSUFFICIENT_INFORMATION")).toBe(
      "REQUEST_FURTHER_INFO",
    );
    const score = scoreLoabOutcome("DECLINE", "DECLINE");
    expect(score.exactMatch).toBe(true);
    expect(score.processRubric).toBe("not_scored");
    expect(score.reason).toBe(CONSTRUCT.loab.mismatch);
    expect(scoreLoabOutcome("APPROVE", "DECLINE").exactMatch).toBe(false);
  });

  it("does not treat a compile or process skip as a full-rubric pass", () => {
    const score = scoreLoabOutcome("APPROVE", "APPROVE");
    expect(score).not.toHaveProperty("fullRubricPass");
    expect(JSON.stringify(score)).not.toMatch(/10×|99\.2%|75%/);
  });

  it("extracts a decision from memo text when needed", () => {
    expect(
      extractLoabOutcome({
        memoMarkdown: "Recommendation: DECLINE on DTI.",
      }),
    ).toBe("DECLINE");
  });
});
