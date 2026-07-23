export interface ScenarioState {
  state: string;
  transitions: ScenarioTransition[];
}

export interface ScenarioTransition {
  from: string;
  when: { tool: string; requestedConcepts: string[] };
  response: {
    status: "AVAILABLE" | "ALREADY_PROVIDED" | "NEEDS_CLARIFICATION";
    revealDocuments?: string[];
  };
  to: string;
}

export class ScenarioEngine {
  processRequest(_concepts: string[]): {
    status: string;
    revealDocuments?: string[];
  } {
    return { status: "NEEDS_CLARIFICATION" };
  }
}
