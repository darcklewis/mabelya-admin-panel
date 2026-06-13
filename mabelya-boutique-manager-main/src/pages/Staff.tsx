import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Plus, UserCheck, Download, Pencil, Trash2, FileSpreadsheet } from "lucide-react";
import { exportCSV } from "@/lib/exportCSV";
import { toast } from "sonner";
import { formatCurrency } from "@/lib/constants";
import jsPDF from "jspdf";
import "jspdf-autotable";

const rolesList = ["Vendeur", "Caissier", "Gérant", "Styliste", "Autre"];

const emptyForm = { boutique_id: "", full_name: "", role: "Vendeur", phone: "", salary: "", is_active: true };

export default function Staff() {
  const queryClient = useQueryClient();

  // Modal ajouter
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ ...emptyForm });

  // Modal modifier
  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState<any>(null);

  // Filtres
  const [filterCountry, setFilterCountry] = useState<string>("all");
  const [filterBoutique, setFilterBoutique] = useState<string>("all");

  const { data: countries } = useQuery({
    queryKey: ["countries"],
    queryFn: async () => {
      const { data } = await supabase.from("countries").select("*").order("name");
      return data ?? [];
    },
  });

  const { data: boutiques } = useQuery({
    queryKey: ["boutiques"],
    queryFn: async () => {
      const { data } = await supabase.from("boutiques").select("*, countries(name)").order("name");
      return data ?? [];
    },
  });

  const { data: staff, isLoading } = useQuery({
    queryKey: ["staff"],
    queryFn: async () => {
      const { data } = await supabase
        .from("staff")
        .select("*, boutiques(name, country_id, countries(name))")
        .order("full_name");
      return data ?? [];
    },
  });

  // Ajouter employé — Corrigé pour insertion SQL directe (Plus d'Edge Function bloquante)
  const addStaff = useMutation({
    mutationFn: async () => {
      if (!form.full_name.trim()) throw new Error("Le nom est obligatoire");
      if (!form.boutique_id) throw new Error("La boutique est obligatoire");
      
      const { error } = await supabase.from("staff").insert({
        full_name: form.full_name.trim(),
        boutique_id: form.boutique_id,
        role: form.role,
        phone: form.phone.trim() || null,
        salary: parseFloat(form.salary) || 0,
        is_active: form.is_active,
      });

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["staff"] });
      setOpen(false);
      setForm({ ...emptyForm });
      toast.success("Personnel ajouté avec succès !");
    },
    onError: (err: any) => toast.error(err.message || "Erreur lors de l'ajout"),
  });

  // Modifier employé
  const updateStaff = useMutation({
    mutationFn: async () => {
      if (!editForm?.full_name?.trim()) throw new Error("Le nom est obligatoire");
      const { error } = await supabase
        .from("staff")
        .update({
          full_name: editForm.full_name.trim(),
          role: editForm.role,
          phone: editForm.phone.trim() || null,
          salary: parseFloat(editForm.salary) || 0,
          boutique_id: editForm.boutique_id,
          is_active: editForm.is_active,
          updated_at: new Date().toISOString(),
        })
        .eq("id", editForm.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["staff"] });
      setEditOpen(false);
      setEditForm(null);
      toast.success("Profil modifié avec succès !");
    },
    onError: (err: any) => toast.error(err.message || "Erreur lors de la modification"),
  });

  // Supprimer employé
  const deleteStaff = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("staff").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["staff"] });
      toast.success("Employé supprimé");
    },
    onError: () => toast.error("Erreur lors de la suppression"),
  });

  const handleDelete = (id: string, name: string) => {
    if (window.confirm(`Supprimer ${name} ? Cette action est irréversible.`)) {
      deleteStaff.mutate(id);
    }
  };

  const handleEdit = (s: any) => {
    setEditForm({
      id: s.id,
      full_name: s.full_name,
      role: s.role,
      phone: s.phone || "",
      salary: String(s.salary || ""),
      boutique_id: s.boutique_id,
      is_active: s.is_active,
    });
    setEditOpen(true);
  };

  const filteredBoutiques = boutiques?.filter(
    (b) => filterCountry === "all" || (b as any).country_id === filterCountry
  );

  const filtered = staff?.filter((s) => {
    const matchCountry = filterCountry === "all" || (s.boutiques as any)?.country_id === filterCountry;
    const matchBoutique = filterBoutique === "all" || s.boutique_id === filterBoutique;
    return matchCountry && matchBoutique;
  });

  const totalSalaries = filtered?.reduce((sum, s) => sum + Number(s.salary), 0) ?? 0;

  const exportPDF = () => {
    const doc = new jsPDF();
    doc.setFontSize(18);
    doc.text("Personnel — Mabelya", 14, 22);
    doc.setFontSize(10);
    doc.text(`${filtered?.length ?? 0} employés — ${new Date().toLocaleDateString("fr-FR")}`, 14, 30);
    const rows = (filtered ?? []).map((s) => [
      s.full_name, s.role, formatCurrency(Number(s.salary)),
      (s.boutiques as any)?.name ?? "—", (s.boutiques as any)?.countries?.name ?? "—",
      s.phone || "—", s.is_active ? "Actif" : "Inactif",
    ]);
    (doc as any).autoTable({
      startY: 36,
      head: [["Nom", "Rôle", "Salaire", "Boutique", "Pays", "Téléphone", "Statut"]],
      body: rows,
      styles: { fontSize: 8 },
      headStyles: { fillColor: [200, 50, 80] },
    });
    doc.save("personnel-mabelya.pdf");
  };

  const exportStaffCSV = () => {
    const headers = ["Nom", "Rôle", "Salaire", "Boutique", "Pays", "Téléphone", "Statut"];
    const rows = (filtered ?? []).map((s) => [
      s.full_name, s.role, Number(s.salary), (s.boutiques as any)?.name, (s.boutiques as any)?.countries?.name, s.phone, s.is_active ? "Actif" : "Inactif",
    ]);
    exportCSV("personnel-mabelya.csv", headers, rows);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-display font-bold">Gestion du Personnel</h1>
          <p className="text-sm text-muted-foreground">{filtered?.length ?? 0} employés</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={exportPDF}>
            <Download className="h-4 w-4 mr-2" /> PDF
          </Button>
          <Button variant="outline" size="sm" onClick={exportStaffCSV}>
            <FileSpreadsheet className="h-4 w-4 mr-2" /> CSV
          </Button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm"><Plus className="h-4 w-4 mr-2" />Ajouter</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Ajouter un employé</DialogTitle></DialogHeader>
              <div className="space-y-4">
                <div>
                  <label className="text-sm font-medium mb-1 block">Boutique *</label>
                  <Select value={form.boutique_id} onValueChange={(v) => setForm({ ...form, boutique_id: v })}>
                    <SelectTrigger><SelectValue placeholder="Choisir une boutique" /></SelectTrigger>
                    <SelectContent>
                      {boutiques?.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">Nom et prénom *</label>
                  <Input
                    placeholder="Ex: Aminata Koné"
                    value={form.full_name}
                    onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">Poste</label>
                  <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v })}>
                    <SelectTrigger><SelectValue placeholder="Choisir un rôle" /></SelectTrigger>
                    <SelectContent>
                      {rolesList.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">Téléphone</label>
                  <Input
                    placeholder="Ex: +228 90 00 00 00"
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">Salaire (FCFA)</label>
                  <Input
                    type="number"
                    placeholder="Ex: 150000"
                    value={form.salary}
                    onChange={(e) => setForm({ ...form, salary: e.target.value })}
                  />
                </div>
                <Button
                  onClick={() => addStaff.mutate()}
                  disabled={!form.boutique_id || !form.full_name || addStaff.isPending}
                  className="w-full"
                >
                  {addStaff.isPending ? "Enregistrement..." : "Enregistrer"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Modal Modifier */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Modifier le profil employé</DialogTitle></DialogHeader>
          {editForm && (
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium mb-1 block">Boutique *</label>
                <Select value={editForm.boutique_id} onValueChange={(v) => setEditForm({ ...editForm, boutique_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Choisir une boutique" /></SelectTrigger>
                  <SelectContent>
                    {boutiques?.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Nom et prénom *</label>
                <Input
                  value={editForm.full_name}
                  onChange={(e) => setEditForm({ ...editForm, full_name: e.target.value })}
                  placeholder="Ex: Aminata Koné"
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Poste</label>
                <Select value={editForm.role} onValueChange={(v) => setEditForm({ ...editForm, role: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {rolesList.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Téléphone</label>
                <Input
                  value={editForm.phone}
                  onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                  placeholder="Ex: +228 90 00 00 00"
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Salaire (FCFA)</label>
                <Input
                  type="number"
                  value={editForm.salary}
                  onChange={(e) => setEditForm({ ...editForm, salary: e.target.value })}
                  placeholder="Ex: 150000"
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Statut</label>
                <Select
                  value={editForm.is_active ? "actif" : "inactif"}
                  onValueChange={(v) => setEditForm({ ...editForm, is_active: v === "actif" })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="actif">Actif</SelectItem>
                    <SelectItem value="inactif">Inactif</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex gap-2 pt-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => { setEditOpen(false); setEditForm(null); }}
                >
                  Annuler
                </Button>
                <Button
                  className="flex-1"
                  onClick={() => updateStaff.mutate()}
                  disabled={!editForm.full_name || !editForm.boutique_id || updateStaff.isPending}
                >
                  {updateStaff.isPending ? "Enregistrement..." : "Sauvegarder"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Filtres */}
      <div className="flex flex-wrap gap-3">
        <Select value={filterCountry} onValueChange={(v) => { setFilterCountry(v); setFilterBoutique("all"); }}>
          <SelectTrigger className="w-36"><SelectValue placeholder="Pays" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tous pays</SelectItem>
            {countries?.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterBoutique} onValueChange={setFilterBoutique}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Boutique" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Toutes boutiques</SelectItem>
            {filteredBoutiques?.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card><CardContent className="p-5">
          <div className="flex items-center gap-3">
            <div className="h-11 w-11 rounded-xl bg-primary/10 flex items-center justify-center">
              <UserCheck className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Total employés actifs</p>
              <p className="text-xl font-bold">{filtered?.filter((s) => s.is_active).length ?? 0}</p>
            </div>
          </div>
        </CardContent></Card>
        <Card><CardContent className="p-5">
          <div className="flex items-center gap-3">
            <div className="h-11 w-11 rounded-xl bg-warning/10 flex items-center justify-center">
              <UserCheck className="h-5 w-5 text-warning" />
            </div>
            <div>
              <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Masse salariale</p>
              <p className="text-xl font-bold">{formatCurrency(totalSalaries)}</p>
            </div>
          </div>
        </CardContent></Card>
      </div>

      {/* Tableau */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nom et prénom</TableHead>
                <TableHead>Rôle</TableHead>
                <TableHead className="text-right">Salaire</TableHead>
                <TableHead className="hidden md:table-cell">Boutique</TableHead>
                <TableHead className="hidden md:table-cell">Pays</TableHead>
                <TableHead className="hidden lg:table-cell">Téléphone</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead className="text-center">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Chargement...</TableCell></TableRow>
              ) : filtered?.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Aucun employé</TableCell></TableRow>
              ) : (
                filtered?.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">{s.full_name}</TableCell>
                    <TableCell><Badge variant="secondary" className="text-xs">{s.role}</Badge></TableCell>
                    <TableCell className="text-right font-medium">{formatCurrency(Number(s.salary))}</TableCell>
                    <TableCell className="hidden md:table-cell text-sm">{(s.boutiques as any)?.name}</TableCell>
                    <TableCell className="hidden md:table-cell text-sm">{(s.boutiques as any)?.countries?.name}</TableCell>
                    <TableCell className="hidden lg:table-cell text-sm">{s.phone || "—"}</TableCell>
                    <TableCell>
                      <Badge className={`text-xs border-0 ${s.is_active ? "bg-green-500/10 text-green-600" : "bg-muted text-muted-foreground"}`}>
                        {s.is_active ? "Actif" : "Inactif"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-center gap-2">
                        {/* Bouton Modifier */}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleEdit(s)}
                          className="h-8 w-8 p-0 hover:bg-primary/10 hover:text-primary"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        {/* Bouton Supprimer */}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDelete(s.id, s.full_name)}
                          className="h-8 w-8 p-0 hover:bg-red-500/10 hover:text-red-500"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
