import { CaseSchema } from "./case.js";

export function validateCase(caseData: unknown): {
  success: boolean;
  error?: string;
} {
  const result = CaseSchema.safeParse(caseData);
  if (!result.success) {
    return { success: false, error: result.error.message };
  }
  return { success: true };
}
