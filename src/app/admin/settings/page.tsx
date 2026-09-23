import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { InventoryItem } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ItemForm, SettingsForm } from "./forms";

export default async function SettingsPage() {
  await requireRole("admin");
  const supabase = await createClient();
  const [settings, items] = await Promise.all([
    supabase.from("app_settings").select("*").eq("id", 1).single(),
    supabase.from("inventory_items").select("*").order("sort_order"),
  ]);
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">Settings</h1>
      <Card>
        <CardHeader>
          <CardTitle>Business</CardTitle>
        </CardHeader>
        <CardContent>
          <SettingsForm s={settings.data} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Supply items</CardTitle>
          <p className="text-sm text-muted-foreground">
            Yield = servings per unit (e.g. 1 premix bag ≈ 45 servings). Cones and cups are counted by stores every day. Toppings linked to products are consumed per sale.
          </p>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {((items.data ?? []) as InventoryItem[]).map((i) => (
            <ItemForm key={i.id} item={i} />
          ))}
          <ItemForm />
        </CardContent>
      </Card>
    </div>
  );
}
