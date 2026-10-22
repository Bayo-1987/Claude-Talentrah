import { describe, expect, it } from "vitest";
import type { NotificationTableRows, PushSubscriptionClientRow } from "@/lib/notifications/contract";
import type { NOTIFICATION_TABLES } from "@/lib/notifications/contract-db";
import type { Tables } from "@/lib/supabase/types";

/**
 * TYPE-LEVEL CONFORMANCE (the contract against the generated types). Every column of a hand-written row type must exist in the generated row of the same table, with a type the
 * generated one accepts. A column renamed in the contract, or a column the migration renames and the types are regenerated for, is a compile error in this file, so `tsc` (the repo's
 * type check, which covers tests/) fails. The assertions are types; the runtime test below only records that the file is part of the run.
 *
 * Red-first proof, recorded in the checkpoint report: rename one column in a contract row type (user_id to userid in the deliveries row) and `tsc --noEmit` fails here; restore and it passes.
 * A second mutant renames the column in the generated types instead and fails the same way.
 */
type Conforms<C, R> = { [K in keyof C]: K extends keyof R ? ([C[K]] extends [R[K]] ? true : false) : false };
/** A single false anywhere makes this `never`, so assigning `true` to it is an error. */
type AllTrue<T> = false extends T[keyof T] ? never : true;

const deliveries: AllTrue<Conforms<NotificationTableRows["deliveries"], Tables<typeof NOTIFICATION_TABLES.deliveries>>> = true;
const devices: AllTrue<Conforms<NotificationTableRows["pushSubscriptions"], Tables<typeof NOTIFICATION_TABLES.pushSubscriptions>>> = true;
const devicesClient: AllTrue<Conforms<PushSubscriptionClientRow, Tables<typeof NOTIFICATION_TABLES.pushSubscriptions>>> = true;
const messages: AllTrue<Conforms<NotificationTableRows["adminMessages"], Tables<typeof NOTIFICATION_TABLES.adminMessages>>> = true;
const recipients: AllTrue<Conforms<NotificationTableRows["adminMessageRecipients"], Tables<typeof NOTIFICATION_TABLES.adminMessageRecipients>>> = true;
const events: AllTrue<Conforms<NotificationTableRows["adminMessageEvents"], Tables<typeof NOTIFICATION_TABLES.adminMessageEvents>>> = true;
const settings: AllTrue<Conforms<NotificationTableRows["settings"], Tables<typeof NOTIFICATION_TABLES.settings>>> = true;
const changes: AllTrue<Conforms<NotificationTableRows["settingChanges"], Tables<typeof NOTIFICATION_TABLES.settingChanges>>> = true;

describe("the contract's row types conform to the generated types (checked by tsc)", () => {
  it("is compiled with the rest of the tests", () => {
    expect([deliveries, devices, devicesClient, messages, recipients, events, settings, changes]).toEqual(Array(8).fill(true));
  });
});
