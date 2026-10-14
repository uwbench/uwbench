import { loadAgentContract, type LoabAgentContract } from "./contracts.js";
import type { LoabToolGateway } from "./gateway.js";
import {
  applicationDocuments,
  assessedIncome,
  claimedIncome,
  dvsResult,
  equifaxScore,
  identityFromProfile,
  isSelfEmployed,
  loanAmount,
  numberField,
  pickVariableRate,
  privacyConsentMissing,
  productCode,
  propertyAddress,
  purchasePrice,
  stringField,
  toolData,
  valuationEstimate,
} from "./facts.js";
import type {
  LoabHandoff,
  LoabProcessTrace,
  LoabTaskFacts,
  LoabToolCall,
  LoabTranscriptStep,
} from "./types.js";

/**
 * Generic origination workflow from LOAB agent contracts + Meridian policy +
 * the credit file. No task ids, no expected outcomes, no rubric reads.
 */
export async function orchestrateOrigination(options: {
  root: string;
  facts: LoabTaskFacts;
  gateway: LoabToolGateway;
}): Promise<LoabProcessTrace> {
  const { root, facts, gateway } = options;
  const transcript: LoabTranscriptStep[] = [];
  const handoffs: LoabHandoff[] = [];
  let agent = facts.startingAgent || "processing_officer";
  let step = 1;
  let stopReason: string | undefined;

  while (agent && step <= facts.maxSteps) {
    const contract = loadAgentContract(root, agent);
    const stepResult =
      agent === "processing_officer"
        ? await runProcessingOfficer(contract, facts, gateway)
        : await runCreditAssessor(
            contract,
            facts,
            gateway,
            priorHandoffs(handoffs),
          );

    const decision = stringField(stepResult.decision, "decision");
    const rule = decision ? contract.validDecisions[decision] : undefined;
    let protocolError: string | undefined;
    if (!decision) protocolError = "missing_or_invalid_decision_json";
    else if (!rule) protocolError = `invalid_decision_for_agent:${decision}`;
    else if (rule.handoff_required && !stepResult.handoff) {
      protocolError = `handoff_required_but_missing:${decision}`;
    }

    const entry: LoabTranscriptStep = {
      step,
      agent,
      allowed_tools: contract.allowedTools,
      tool_calls: stepResult.toolCalls,
      assistant_response: stepResult.assistantResponse,
      handoff_payload: stepResult.handoff ?? null,
      decision_json: stepResult.decision,
      decision_contract_rule: rule
        ? {
            terminal: rule.terminal,
            handoff_required: rule.handoff_required,
            next_agent: rule.next_agent,
            advance_workflow: rule.advance_workflow,
          }
        : null,
      protocol_error: protocolError ?? null,
    };
    transcript.push(entry);

    const nextAgent = rule?.next_agent ?? null;
    if (stepResult.handoff) {
      const handoff: LoabHandoff = {
        step,
        from_agent: agent,
        to_agent: nextAgent,
        payload: stepResult.handoff,
      };
      handoffs.push(handoff);
    }

    if (protocolError) {
      stopReason = protocolError;
      break;
    }
    if (rule?.terminal) {
      stopReason = `terminal_decision:${decision}`;
      break;
    }
    if (!rule?.advance_workflow || !nextAgent) {
      stopReason = `non_terminal_no_advance:${decision}`;
      break;
    }
    agent = nextAgent;
    step += 1;
  }

  if (!stopReason && step > facts.maxSteps) {
    stopReason = `max_steps_exceeded:${facts.maxSteps}`;
  }

  return {
    transcript,
    handoffs,
    gatewayKind: gateway.kind,
    ...(stopReason ? { stopReason } : {}),
  };
}

interface StepResult {
  toolCalls: LoabToolCall[];
  assistantResponse: string;
  decision: Record<string, unknown>;
  handoff?: Record<string, unknown>;
}

async function runProcessingOfficer(
  contract: LoabAgentContract,
  facts: LoabTaskFacts,
  gateway: LoabToolGateway,
): Promise<StepResult> {
  const toolCalls: LoabToolCall[] = [];
  const call = async (
    name: string,
    args: Record<string, unknown>,
  ): Promise<unknown> => {
    if (!contract.allowedTools.includes(name)) {
      throw new Error(`${contract.agent} is not allowed to call ${name}`);
    }
    const result = await gateway.call(name, args);
    toolCalls.push({ name, arguments: args, result });
    return result;
  };

  const policy42 = await call("policy_lookup", { section: "Section 4.2" });
  const policy22 = await call("policy_lookup", { section: "Section 2.2" });

  if (privacyConsentMissing(facts.pending)) {
    const decision = {
      decision: "REQUEST_FURTHER_INFO",
      rationale:
        "Privacy consent is missing or unsigned. Section 4.2 and Section 4.4 require signed privacy consent before any external verification, bureau pull, valuation, or income check.",
    };
    return {
      toolCalls,
      assistantResponse: renderAssistant({
        role: contract.agent,
        policy: {
          "Section 4.2": toolData(policy42),
          "Section 2.2": toolData(policy22),
        },
        findings: {
          privacy_consent_missing: true,
          documents_submitted: facts.pending["documents_submitted"] ?? [],
        },
        decision,
      }),
      decision,
    };
  }

  const identity = identityFromProfile(facts.profile);
  const verifyArgs = {
    ...(identity.full_name ? { full_name: identity.full_name } : {}),
    ...(identity.dob ? { dob: identity.dob } : {}),
    ...(identity.residential_address
      ? { residential_address: identity.residential_address }
      : {}),
  };
  const greenid = await call("greenid_verify", verifyArgs);
  const equifax = await call("equifax_pull", verifyArgs);
  const property = propertyAddress(facts.profile, facts.pending);
  const corelogic = property
    ? await call("corelogic_valuation", { property_address: property })
    : undefined;
  const income = claimedIncome(facts.profile);
  const ato =
    identity.tfn && income !== undefined
      ? await call("ato_income_verify", {
          tfn: identity.tfn,
          income_claimed: income,
        })
      : undefined;
  let asic: unknown;
  if (isSelfEmployed(facts.profile) && identity.abn) {
    asic = await call("asic_lookup", { abn: identity.abn });
  }

  await call("policy_lookup", { section: "Section 2.3" });
  const policy61 = await call("policy_lookup", { section: "Section 6.1" });

  const score = equifaxScore(equifax);
  const dvs = dvsResult(greenid);
  const selfEmployed = isSelfEmployed(facts.profile);
  let decisionName = "REFER_UNDERWRITER";
  let referralReason: string | undefined;
  if (dvs && /mismatch|not.?matched|fail/i.test(dvs)) {
    decisionName = "REFER_FRAUD_ANALYST";
    referralReason = `DVS result ${dvs} requires Financial Crime hold per Section 2.2 / 3.3.`;
  } else if (selfEmployed) {
    decisionName = "REFER_CREDIT_MANAGER";
    referralReason =
      "Self-employed income is a mandatory Credit Manager referral (Section 2.2 / 2.3).";
  } else if (score !== undefined && score < 650) {
    decisionName = "REFER_CREDIT_MANAGER";
    referralReason =
      score < 580
        ? "Equifax score below 580 is a Credit Manager hard-decline pathway (Section 2.3 / 6.1)."
        : "Equifax score 580-649 is near-prime and requires Credit Manager authority (Section 2.2 / 6.1).";
  }

  const results: Record<string, unknown> = {
    greenid_verify_result: greenid,
    greenid_result: greenid,
    equifax_pull_result: equifax,
    equifax_result: equifax,
    ...(corelogic
      ? {
          corelogic_valuation_result: corelogic,
          corelogic_result: corelogic,
        }
      : {}),
    ...(ato ? { ato_income_verify_result: ato, ato_result: ato } : {}),
    ...(asic ? { asic_lookup_result: asic, asic_result: asic } : {}),
  };
  const verificationSummary = {
    documents_reviewed: Object.keys(applicationDocuments(facts.pending)),
    checks_completed: toolCalls.map((call) => call.name),
    key_findings: {
      dvs_result: dvs,
      equifax_score: score,
      self_employed: selfEmployed,
      ato_status: stringField(toolData(ato), "status"),
      valuation: valuationEstimate(corelogic),
    },
    routing_basis:
      referralReason ?? "PAYG file with no mandatory referral triggers.",
  };
  const handoff = {
    ...results,
    verification_summary: verificationSummary,
    ...(referralReason ? { referral_reason: referralReason } : {}),
  };
  const decision = {
    decision: decisionName,
    rationale:
      referralReason ??
      "Verification complete. File packaged for underwriter assessment under Section 2.2.",
  };
  return {
    toolCalls,
    assistantResponse: renderAssistant({
      role: contract.agent,
      policy: {
        "Section 4.2": toolData(policy42),
        "Section 6.1": toolData(policy61),
      },
      findings: verificationSummary,
      toolResults: results,
      decision,
    }),
    decision,
    handoff,
  };
}

async function runCreditAssessor(
  contract: LoabAgentContract,
  facts: LoabTaskFacts,
  gateway: LoabToolGateway,
  prior: LoabHandoff[],
): Promise<StepResult> {
  const toolCalls: LoabToolCall[] = [];
  const call = async (
    name: string,
    args: Record<string, unknown>,
  ): Promise<unknown> => {
    if (!contract.allowedTools.includes(name)) {
      throw new Error(`${contract.agent} is not allowed to call ${name}`);
    }
    const result = await gateway.call(name, args);
    toolCalls.push({ name, arguments: args, result });
    return result;
  };

  const code = productCode(facts.profile, facts.pending);
  const product = code
    ? await call("product_lookup", { product_code: code })
    : undefined;
  const sections = unique([
    "Section 5.2",
    "Section 5.5",
    "Section 6.1",
    ...contract.policySections.filter((section) =>
      /Section\s+(2\.3|5\.2|5\.3|5\.5|6\.1|6\.3)/.test(section),
    ),
  ]);
  const policyHits: Record<string, unknown> = {};
  for (const section of sections) {
    policyHits[section] = await call("policy_lookup", { section });
  }

  const latestEquifax =
    prior
      .map(
        (handoff) =>
          handoff.payload["equifax_pull_result"] ??
          handoff.payload["equifax_result"],
      )
      .find((value) => value !== undefined) ??
    toolCalls.find((call) => call.name === "equifax_pull")?.result;
  const latestValuation = prior
    .map(
      (handoff) =>
        handoff.payload["corelogic_valuation_result"] ??
        handoff.payload["corelogic_result"],
    )
    .find((value) => value !== undefined);
  const score = equifaxScore(latestEquifax);
  const amount = loanAmount(facts.profile, facts.pending);
  const income = assessedIncome(facts.profile);
  const dti =
    amount !== undefined && income && income > 0 ? amount / income : undefined;
  const value = valuationEstimate(latestValuation);
  const price = purchasePrice(facts.profile);
  const security =
    value !== undefined && price !== undefined
      ? Math.min(value, price)
      : (value ?? price);
  const lvr =
    amount !== undefined && security && security > 0
      ? (amount / security) * 100
      : undefined;
  const productData = toolData(product);
  const maxDti = numberField(productData, "max_dti") ?? 6;
  const maxLvr = numberField(productData, "max_lvr");
  const productRate = pickVariableRate(productData, lvr);
  const buffer = dti !== undefined && dti > 4 ? 4 : 3;
  const assessmentRate =
    productRate !== undefined ? round2(productRate + buffer) : undefined;

  let decisionName = "APPROVE";
  let rationale =
    "File meets retrieved policy criteria within delegated authority.";
  if (score !== undefined && score < 580) {
    decisionName = "DECLINE";
    rationale =
      "Equifax score below 580 is a hard decline under Section 6.1 with no exception pathway.";
  } else if (dti !== undefined && dti > maxDti) {
    decisionName = "DECLINE";
    rationale = `Assessed DTI ${dti.toFixed(2)}x exceeds the ${maxDti.toFixed(1)}x hard limit in Section 5.5. No exception pathway.`;
  } else if (lvr !== undefined && maxLvr !== undefined && lvr > maxLvr) {
    decisionName = "DECLINE";
    rationale = `LVR ${lvr.toFixed(2)}% exceeds the product maximum ${maxLvr}%.`;
  }

  const decision: Record<string, unknown> = {
    decision: decisionName,
    rationale,
    ...(decisionName === "APPROVE" || decisionName === "CONDITIONAL_APPROVE"
      ? {
          ...(productRate !== undefined
            ? { final_interest_rate: productRate }
            : {}),
          ...(assessmentRate !== undefined
            ? { assessment_interest_rate: assessmentRate }
            : {}),
        }
      : {}),
    assessment: {
      equifax_score: score,
      dti,
      lvr,
      assessed_income: income,
      proposed_loan: amount,
    },
  };

  return {
    toolCalls,
    assistantResponse: renderAssistant({
      role: contract.agent,
      policy: Object.fromEntries(
        Object.entries(policyHits).map(([key, value]) => [
          key,
          toolData(value),
        ]),
      ),
      findings: decision["assessment"],
      toolResults: {
        ...(product ? { product_lookup_result: product } : {}),
        ...policyHits,
      },
      decision,
    }),
    decision,
  };
}

function priorHandoffs(handoffs: LoabHandoff[]): LoabHandoff[] {
  return handoffs;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function renderAssistant(input: {
  role: string;
  policy?: Record<string, unknown>;
  findings?: unknown;
  toolResults?: Record<string, unknown>;
  decision: Record<string, unknown>;
}): string {
  return [
    `Role: ${input.role}`,
    "Policy excerpts used in this step:",
    JSON.stringify(input.policy ?? {}, null, 2),
    "Findings:",
    JSON.stringify(input.findings ?? {}, null, 2),
    "Tool results:",
    JSON.stringify(input.toolResults ?? {}, null, 2),
    "```decision_json",
    JSON.stringify(input.decision, null, 2),
    "```",
  ].join("\n");
}
