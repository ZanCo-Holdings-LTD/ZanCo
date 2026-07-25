import "server-only";

import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { entities, holders, memberships, users } from "@/db/schema";

/** Shared option loads for the record and holder forms. */
export async function formOptions(organisationId: string) {
  const [entityRows, holderRows, memberRows] = await Promise.all([
    db
      .select({ id: entities.id, name: entities.name, country: entities.country })
      .from(entities)
      .where(and(eq(entities.organisationId, organisationId), isNull(entities.archivedAt)))
      .orderBy(asc(entities.name)),
    db
      .select({
        id: holders.id,
        name: holders.name,
        entityId: holders.entityId,
        kind: holders.kind,
      })
      .from(holders)
      .where(and(eq(holders.organisationId, organisationId), isNull(holders.archivedAt)))
      .orderBy(asc(holders.name)),
    db
      .select({ id: users.id, name: users.name })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.organisationId, organisationId))
      .orderBy(asc(users.name)),
  ]);

  return { entities: entityRows, holders: holderRows, members: memberRows };
}
