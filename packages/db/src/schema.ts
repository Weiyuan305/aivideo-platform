import {
  pgTable,
  text,
  timestamp,
  boolean,
  uuid,
  jsonb,
  integer,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

// Better Auth IDs are strings. Never reuse Starter's serial user IDs.
export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export const session = pgTable("session", {
  id: text("id").primaryKey(),
  token: text("token").notNull().unique(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
});
export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  scope: text("scope"),
  password: text("password"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
// Schema scaffold only; browser drafts stay separate until authenticated services land.
export const assets = pgTable(
  "assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id),
    name: text("name").notNull(),
    kind: text("kind").notNull(),
    objectKey: text("object_key").notNull().unique(),
    sha256: text("sha256"),
    sourceJobId: uuid("source_job_id"),
    mime: text("mime").notNull(),
    bytes: integer("bytes").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("assets_owner_created").on(
      t.ownerUserId,
      t.createdAt.desc(),
      t.id.desc(),
    ),
  ],
);
export const voices = pgTable("voices", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerUserId: text("owner_user_id")
    .notNull()
    .references(() => user.id),
  name: text("name").notNull(),
  referenceAssetId: uuid("reference_asset_id")
    .notNull()
    .references(() => assets.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export const workflows = pgTable("workflows", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerUserId: text("owner_user_id")
    .notNull()
    .references(() => user.id),
  name: text("name").notNull(),
  graph: jsonb("graph").notNull(),
  version: integer("version").notNull().default(1),
  history: jsonb("history").notNull().default([]),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id),
    idempotencyKey: text("idempotency_key").notNull(),
    fingerprint: text("fingerprint").notNull(),
    status: text("status").notNull(),
    payload: jsonb("payload").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("jobs_owner_key").on(t.ownerUserId, t.idempotencyKey),
    index("jobs_status").on(t.status),
    index("jobs_owner_created").on(
      t.ownerUserId,
      t.createdAt.desc(),
      t.id.desc(),
    ),
  ],
);
export const jobOutbox = pgTable("job_outbox", {
  id: uuid("id").primaryKey().defaultRandom(),
  jobId: uuid("job_id")
    .notNull()
    .references(() => jobs.id),
  delivered: boolean("delivered").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export const providerOperations = pgTable("provider_operations", {
  key: text("key").primaryKey(),
  jobId: uuid("job_id")
    .notNull()
    .references(() => jobs.id),
  provider: text("provider").notNull(),
  state: text("state").notNull(),
  requestId: text("request_id"),
  outputs: jsonb("outputs"),
  outcome: jsonb("outcome"),
  assetIds: jsonb("asset_ids").notNull().default([]),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export const providerEvents = pgTable("provider_events", {
  id: text("id").primaryKey(),
  fingerprint: text("fingerprint").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export const workerHeartbeats = pgTable("worker_heartbeats", {
  id: uuid("id").primaryKey(),
  queueSchema: text("queue_schema").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  heartbeatAt: timestamp("heartbeat_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  dispatchAt: timestamp("dispatch_at", { withTimezone: true }),
  errorAt: timestamp("error_at", { withTimezone: true }),
  transportReady: boolean("transport_ready").notNull().default(false),
  stoppedAt: timestamp("stopped_at", { withTimezone: true }),
});

export const productions = pgTable(
  "productions",
  {
    id: uuid("id").primaryKey(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id),
    name: text("name").notNull(),
    payload: jsonb("payload").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("productions_owner_updated").on(t.ownerUserId, t.updatedAt)],
);
export const productionReferences = pgTable(
  "production_references",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => productions.id, { onDelete: "cascade" }),
    resourceKind: text("resource_kind").notNull(),
    resourceId: uuid("resource_id").notNull(),
  },
  (t) => [
    uniqueIndex("production_ref_unique").on(
      t.projectId,
      t.resourceKind,
      t.resourceId,
    ),
    index("production_ref_resource").on(t.resourceKind, t.resourceId),
  ],
);
