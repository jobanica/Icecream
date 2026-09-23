"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireRole } from "@/lib/auth";
import { partnerEmail } from "@/lib/env";
import { parsePeso } from "@/lib/format";
import type { ActionResult } from "@/components/action-form";

const s = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return v == null ? null : String(v).trim() || null;
};
const done = (ok: string): ActionResult => ({ ok, at: Date.now() });
const fail = (error: string): ActionResult => ({ error, at: Date.now() });

function locationFields(fd: FormData) {
  const pct = Number(s(fd, "partner_share_pct") ?? 50);
  return {
    partner_name: s(fd, "partner_name") ?? "",
    store_name: s(fd, "store_name") ?? "",
    address: s(fd, "address") ?? "",
    contact_phone: s(fd, "contact_phone"),
    contact_email: s(fd, "contact_email"),
    store_hours: s(fd, "store_hours"),
    responsible_person: s(fd, "responsible_person"),
    partnership_start_date: s(fd, "partnership_start_date"),
    partner_share_pct: pct,
    tolerance_servings: Number(s(fd, "tolerance_servings") ?? 3),
    major_threshold_servings: Number(s(fd, "major_threshold_servings") ?? 10),
    remit_gcash_name: s(fd, "remit_gcash_name"),
    remit_gcash_number: s(fd, "remit_gcash_number"),
    remit_bank_name: s(fd, "remit_bank_name"),
    remit_bank_account_name: s(fd, "remit_bank_account_name"),
    remit_bank_account_number: s(fd, "remit_bank_account_number"),
    payout_method: s(fd, "payout_method"),
    payout_account_name: s(fd, "payout_account_name"),
    payout_account_number: s(fd, "payout_account_number"),
    payout_bank_name: s(fd, "payout_bank_name"),
    notes: s(fd, "notes"),
  };
}

export async function createLocation(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireRole("admin");
  const supabase = await createClient();
  const fields = locationFields(fd);
  if (!fields.partner_name || !fields.store_name) return fail("Partner name and store name are required");
  const { data, error } = await supabase.from("locations").insert(fields).select("id").single();
  if (error) return fail(error.message);
  redirect(`/admin/locations/${data.id}`);
}

export async function updateLocation(id: string, _p: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireRole("admin");
  const supabase = await createClient();
  const { error } = await supabase.from("locations").update(locationFields(fd)).eq("id", id);
  if (error) return fail(error.message);
  revalidatePath(`/admin/locations/${id}`);
  return done("Partner file saved");
}

/** Create the partner login (store code + 6-digit PIN) or reset its PIN. */
export async function setPartnerPin(locationId: string, _p: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireRole("admin");
  const pin = s(fd, "pin") ?? "";
  const fullName = s(fd, "full_name") ?? "";
  if (!/^\d{6}$/.test(pin)) return fail("PIN must be exactly 6 digits");
  if (/^(\d)\1{5}$/.test(pin) || pin === "123456" || pin === "654321") return fail("PIN is too easy to guess");
  const supabase = await createClient();
  const { data: loc } = await supabase.from("locations").select("code, partner_name").eq("id", locationId).single();
  if (!loc) return fail("Location not found");

  const admin = createAdminClient();
  const { data: existing } = await admin.from("profiles").select("id").eq("location_id", locationId).eq("role", "partner").maybeSingle();
  if (existing) {
    const { error } = await admin.auth.admin.updateUserById(existing.id, { password: pin });
    if (error) return fail(error.message);
    if (fullName) await admin.from("profiles").update({ full_name: fullName }).eq("id", existing.id);
    revalidatePath(`/admin/locations/${locationId}`);
    return done(`PIN reset for ${loc.code}`);
  }
  const { data: created, error } = await admin.auth.admin.createUser({
    email: partnerEmail(loc.code),
    password: pin,
    email_confirm: true,
    app_metadata: { role: "partner", location_id: locationId },
    user_metadata: { full_name: fullName || loc.partner_name },
  });
  if (error || !created.user) return fail(error?.message ?? "Could not create login");
  // The DB trigger also does this; upsert explicitly so the link never depends on GoTrue's write order.
  const { error: pErr } = await admin
    .from("profiles")
    .upsert({ id: created.user.id, role: "partner", location_id: locationId, full_name: fullName || loc.partner_name });
  if (pErr) return fail(pErr.message);
  revalidatePath(`/admin/locations/${locationId}`);
  return done(`Login created: ${loc.code} + PIN`);
}

export async function addMachine(locationId: string, _p: ActionResult, fd: FormData): Promise<ActionResult> {
  const profile = await requireRole("admin");
  const baseline = Number(s(fd, "baseline_reading"));
  const photo = s(fd, "baseline_photo_path");
  if (!Number.isInteger(baseline) || baseline < 0) return fail("Enter the counter reading at installation");
  if (!photo) return fail("Photo of the counter at installation is required");
  const value = parsePeso(s(fd, "purchase_value") ?? "0");
  const supabase = await createClient();
  const installedAt = new Date().toISOString();
  const { data, error } = await supabase
    .from("machines")
    .insert({
      serial_number: s(fd, "serial_number"),
      model: s(fd, "model") ?? "",
      purchase_value_centavos: value ?? 0,
      counter_max: s(fd, "counter_max") ? Number(s(fd, "counter_max")) : null,
      location_id: locationId,
      status: "active",
      baseline_reading: baseline,
      baseline_photo_path: photo,
      installed_at: installedAt,
    })
    .select("id")
    .single();
  if (error) return fail(error.message.includes("duplicate") ? "That serial number already exists" : error.message);
  await supabase.from("machine_events").insert({
    machine_id: data.id,
    location_id: locationId,
    event_type: "installed",
    occurred_at: installedAt,
    reading_after: baseline,
    photo_path: photo,
    description: `Installed. Baseline counter ${baseline}`,
    recorded_by: profile.id,
  });
  revalidatePath(`/admin/locations/${locationId}`);
  return done("Machine added");
}

export async function recordReset(locationId: string, machineId: string, _p: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireRole("admin", "staff");
  const supabase = await createClient();
  const { error } = await supabase.rpc("record_counter_reset", {
    p_machine_id: machineId,
    p_reading_before: Number(s(fd, "reading_before")),
    p_reading_after: Number(s(fd, "reading_after")),
    p_description: s(fd, "description") ?? "",
  });
  if (error) return fail(error.message);
  revalidatePath(`/admin/locations/${locationId}`);
  return done("Counter reset recorded");
}

export async function logMachineEvent(locationId: string, machineId: string, _p: ActionResult, fd: FormData): Promise<ActionResult> {
  const profile = await requireRole("admin", "staff");
  const supabase = await createClient();
  const cost = parsePeso(s(fd, "cost") ?? "0");
  const { error } = await supabase.from("machine_events").insert({
    machine_id: machineId,
    location_id: locationId,
    event_type: s(fd, "event_type") ?? "maintenance",
    description: s(fd, "description") ?? "",
    cost_centavos: cost ?? 0,
    recorded_by: profile.id,
  });
  if (error) return fail(error.message);
  revalidatePath(`/admin/locations/${locationId}`);
  return done("Logged");
}

export async function saveProduct(locationId: string, _p: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireRole("admin");
  const price = parsePeso(s(fd, "price") ?? "");
  if (price == null || price <= 0) return fail("Enter a valid price");
  const row = {
    location_id: locationId,
    name: s(fd, "name") ?? "",
    price_centavos: price,
    servings_per_unit: Number(s(fd, "servings_per_unit") ?? 1),
    container_type: s(fd, "container_type") ?? "cup",
    sort_order: Number(s(fd, "sort_order") ?? 0),
    is_active: s(fd, "is_active") !== "false",
  };
  if (!row.name) return fail("Name is required");
  const supabase = await createClient();
  const id = s(fd, "id");
  const { error } = id
    ? await supabase.from("products").update(row).eq("id", id)
    : await supabase.from("products").insert(row);
  if (error) return fail(error.message);
  revalidatePath(`/admin/locations/${locationId}`);
  return done(id ? "Product updated (new sales use the new price)" : "Product added");
}

export async function addDefaultProducts(locationId: string): Promise<ActionResult> {
  await requireRole("admin");
  const supabase = await createClient();
  const { error } = await supabase.from("products").insert([
    { location_id: locationId, name: "Cone", price_centavos: 2500, servings_per_unit: 1, container_type: "cone", sort_order: 1 },
    { location_id: locationId, name: "Cup", price_centavos: 5900, servings_per_unit: 1, container_type: "cup", sort_order: 2 },
    { location_id: locationId, name: "Float", price_centavos: 6900, servings_per_unit: 1, container_type: "cup", sort_order: 3 },
    { location_id: locationId, name: "KitKat", price_centavos: 7900, servings_per_unit: 1, container_type: "cup", sort_order: 4 },
  ]);
  if (error) return fail(error.message);
  revalidatePath(`/admin/locations/${locationId}`);
  return done("Standard menu added");
}

export async function saveOpeningInventory(locationId: string, _p: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireRole("admin");
  const supabase = await createClient();
  const { data: items } = await supabase.from("inventory_items").select("id").eq("is_active", true);
  const payload = (items ?? []).map((i) => ({
    item_id: i.id,
    qty: Number(s(fd, `qty_${i.id}`) ?? 0),
    reorder_point: Number(s(fd, `rp_${i.id}`) ?? 0),
  }));
  const { error } = await supabase.rpc("set_opening_inventory", {
    p_location_id: locationId,
    p_date: s(fd, "date"),
    p_items: payload,
  });
  if (error) return fail(error.message);
  revalidatePath(`/admin/locations/${locationId}`);
  return done("Opening inventory saved");
}

export async function saveChecklist(locationId: string, _p: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireRole("admin");
  const checklist: Record<string, boolean> = {};
  for (const [k, v] of fd.entries()) if (k.startsWith("chk_")) checklist[k.slice(4)] = v === "on";
  const supabase = await createClient();
  const { error } = await supabase.from("locations").update({ installation_checklist: checklist }).eq("id", locationId);
  if (error) return fail(error.message);
  revalidatePath(`/admin/locations/${locationId}`);
  return done("Checklist saved");
}

export async function activateLocation(locationId: string): Promise<ActionResult> {
  await requireRole("admin");
  const supabase = await createClient();
  const { error } = await supabase.rpc("activate_location", { p_location_id: locationId });
  if (error) return fail(error.message);
  revalidatePath(`/admin/locations/${locationId}`);
  return done("Location is now ACTIVE 🎉");
}

export async function setLocationStatus(locationId: string, _p: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireRole("admin");
  const status = s(fd, "status");
  if (!status || !["active", "paused", "terminated"].includes(status)) return fail("Invalid status");
  const supabase = await createClient();
  const { data: loc } = await supabase.from("locations").select("status").eq("id", locationId).single();
  if (loc?.status === "pending") return fail("Use Activate for new locations");
  const { error } = await supabase.from("locations").update({ status }).eq("id", locationId);
  if (error) return fail(error.message);
  revalidatePath(`/admin/locations/${locationId}`);
  return done(`Status set to ${status}`);
}
