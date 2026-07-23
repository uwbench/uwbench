import { z } from "zod";

export const ScoreReportSchema = z.object({
  schemaVersion: z.literal("1.0"),
  status: z.enum(["not_scored", "scored"]),
  score: z.number().min(0).max(100).optional(),
  components: z.record(z.unknown()).optional(),
});

export type ScoreReport = z.infer<typeof ScoreReportSchema>;

export const NotScoredSchema = z.object({
  schemaVersion: z.literal("1.0"),
  status: z.literal("not_scored"),
  reason: z.string(),
});

export type NotScored = z.infer<typeof NotScoredSchema>;