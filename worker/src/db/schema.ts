import { CATEGORIES } from "@pawlog/shared";
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  googleSub: text("google_sub").notNull().unique(),
  email: text("email").notNull(),
  displayName: text("display_name").notNull(),
  avatarUrl: text("avatar_url"),
  locale: text("locale", { enum: ["system", "en", "ja"] })
    .notNull()
    .default("system"),
  createdAt: integer("created_at").notNull(),
});

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  tokenHash: text("token_hash").notNull().unique(),
  csrfToken: text("csrf_token").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  createdAt: integer("created_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
  lastSeenAt: integer("last_seen_at").notNull(),
});

export const pets = sqliteTable("pets", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  species: text("species", { enum: ["dog", "cat", "other"] }).notNull(),
  breed: text("breed"),
  sex: text("sex", { enum: ["male", "female", "unknown"] }),
  birthday: text("birthday"), // ISO date YYYY-MM-DD
  avatarR2Key: text("avatar_r2_key"),
  archivedAt: integer("archived_at"),
  createdAt: integer("created_at").notNull(),
});

export const petMembers = sqliteTable(
  "pet_members",
  {
    petId: text("pet_id")
      .notNull()
      .references(() => pets.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["owner", "editor", "viewer"] }).notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.petId, t.userId] })],
);

export const activities = sqliteTable(
  "activities",
  {
    id: text("id").primaryKey(),
    petId: text("pet_id")
      .notNull()
      .references(() => pets.id, { onDelete: "cascade" }),
    category: text("category", { enum: CATEGORIES }).notNull(),
    occurredAt: integer("occurred_at").notNull(),
    tzOffsetMin: integer("tz_offset_min").notNull(),
    memo: text("memo"),
    details: text("details", { mode: "json" }).notNull(),
    createdBy: text("created_by").notNull(),
    updatedBy: text("updated_by"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    deletedAt: integer("deleted_at"),
  },
  (t) => [
    index("idx_activities_pet_time").on(t.petId, t.occurredAt),
    index("idx_activities_pet_cat_time").on(t.petId, t.category, t.occurredAt),
  ],
);

export const activityPhotos = sqliteTable("activity_photos", {
  id: text("id").primaryKey(),
  activityId: text("activity_id")
    .notNull()
    .references(() => activities.id, { onDelete: "cascade" }),
  r2Key: text("r2_key").notNull(),
  width: integer("width"),
  height: integer("height"),
  contentType: text("content_type").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const quickPresets = sqliteTable("quick_presets", {
  id: text("id").primaryKey(),
  petId: text("pet_id")
    .notNull()
    .references(() => pets.id, { onDelete: "cascade" }),
  category: text("category", { enum: CATEGORIES }).notNull(),
  label: text("label").notNull(),
  details: text("details", { mode: "json" }).notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: integer("created_at").notNull(),
});

export const careSchedules = sqliteTable(
  "care_schedules",
  {
    id: text("id").primaryKey(),
    petId: text("pet_id")
      .notNull()
      .references(() => pets.id, { onDelete: "cascade" }),
    type: text("type", {
      enum: ["medication", "vaccination", "vet_visit", "deworming", "grooming", "custom"],
    }).notNull(),
    name: text("name").notNull(),
    categoryLink: text("category_link", { enum: CATEGORIES }).notNull(),
    detailsTemplate: text("details_template", { mode: "json" }).notNull(),
    recurrenceUnit: text("recurrence_unit", {
      enum: ["once", "hour", "day", "week", "month"],
    }).notNull(),
    recurrenceN: integer("recurrence_n"),
    nextDueAt: integer("next_due_at").notNull(),
    endAt: integer("end_at"),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("idx_schedules_pet_active_due").on(t.petId, t.active, t.nextDueAt)],
);

export const petTargets = sqliteTable("pet_targets", {
  petId: text("pet_id")
    .primaryKey()
    .references(() => pets.id, { onDelete: "cascade" }),
  foodGPerDay: real("food_g_per_day"),
  waterMlPerDay: real("water_ml_per_day"),
});

export const auditLog = sqliteTable("audit_log", {
  id: text("id").primaryKey(),
  petId: text("pet_id").notNull(),
  userId: text("user_id").notNull(),
  action: text("action", { enum: ["create", "update", "delete"] }).notNull(),
  entity: text("entity", {
    enum: ["activity", "pet", "schedule", "preset", "member"],
  }).notNull(),
  entityId: text("entity_id").notNull(),
  diff: text("diff", { mode: "json" }),
  createdAt: integer("created_at").notNull(),
});

export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type Pet = typeof pets.$inferSelect;
export type PetMember = typeof petMembers.$inferSelect;
export type Activity = typeof activities.$inferSelect;
