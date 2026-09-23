import { requireRole } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LocationForm } from "../location-form";
import { createLocation } from "../actions";

export default async function NewLocation() {
  await requireRole("admin");
  return (
    <Card>
      <CardHeader>
        <CardTitle>New location</CardTitle>
        <p className="text-sm text-muted-foreground">The SS-### code is assigned automatically. Next you&apos;ll add the partner login, machine, products and opening inventory.</p>
      </CardHeader>
      <CardContent>
        <LocationForm action={createLocation} submitLabel="Create location" />
      </CardContent>
    </Card>
  );
}
