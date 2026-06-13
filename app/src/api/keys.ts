import type { Category } from "@pawary/shared";

/**
 * Query-key conventions (everything pet-scoped starts with [root, petId]):
 *   ["me"]                                      session + pet list
 *   ["pets", petId]                             full PetResponse (targets, breed…)
 *   ["activities", petId, ...]                  every activity list/detail
 *   ["activities", petId, "range", from, to]    calendar/home/day ranges
 *   ["activities", petId, "log", cats, q]       infinite log pages
 *   ["activities", petId, "one", id]            single activity
 *   ["summary", petId, month]                   month-grid category dots
 *   ["presets", petId]                          quick-add presets
 *
 * Invalidation rules (enforced in the mutation hooks):
 *   activity create/update/delete  → ["activities", petId] + ["summary", petId, month-of-activity] + ["insights", petId] + ["anomalies", petId]
 *   photo add/remove               → ["activities", petId]
 *   preset mutations               → ["presets", petId]
 *   pet create/update/avatar       → ["me"] + ["pets", petId]
 *   schedule create/update/delete  → ["schedules", petId] + ["care-status", petId]
 *   schedule complete              → schedules + care-status + activities + summary + insights + anomalies
 *   member/invite mutations          → ["members", petId] (+ ["me"] on role change / removal)
 *   invite accept                    → ["me"]
 *   advisor settings mutations       → ["advisor-settings"]
 *   advisor send/delete              → ["advisor", petId]
 */
export const keys = {
  me: ["me"] as const,
  pet: (petId: string) => ["pets", petId] as const,
  activitiesRoot: (petId: string) => ["activities", petId] as const,
  activitiesRange: (petId: string, from: number, to: number) =>
    ["activities", petId, "range", from, to] as const,
  activitiesLog: (petId: string, categories: Category[], q: string) =>
    ["activities", petId, "log", [...categories].sort().join(","), q] as const,
  activity: (petId: string, id: string) =>
    ["activities", petId, "one", id] as const,
  summaryRoot: (petId: string) => ["summary", petId] as const,
  summary: (petId: string, month: string) => ["summary", petId, month] as const,
  presets: (petId: string) => ["presets", petId] as const,
  schedules: (petId: string) => ["schedules", petId] as const,
  careStatus: (petId: string) => ["care-status", petId] as const,
  insightsRoot: (petId: string) => ["insights", petId] as const,
  insights: (petId: string, period: string) => ["insights", petId, period] as const,
  anomalies: (petId: string) => ["anomalies", petId] as const,
  members: (petId: string) => ["members", petId] as const,
  invitePreview: (token: string) => ["invite-preview", token] as const,
  advisorSettings: ["advisor-settings"] as const,
  advisorConversations: (petId: string) => ["advisor", petId] as const,
  advisorConversation: (petId: string, id: string) => ["advisor", petId, "one", id] as const,
  audit: (petId: string) => ["audit", petId] as const,
};
