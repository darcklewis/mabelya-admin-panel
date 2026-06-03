import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  // Gestion du CORS pour les requêtes de pré-vérification (Preflight)
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Utilisation des variables d'environnement natives de Supabase Edge Functions
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!; // Clé admin indispensable ici
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

    // 1. Vérifier la présence du token d'authentification
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Token d'authentification manquant" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    
    const token = authHeader.replace("Bearer ", "");
    const { data: { user: caller }, error: authError } = await supabaseAdmin.auth.getUser(token);
    
    if (authError || !caller) {
      return new Response(JSON.stringify({ error: "Non authentifié" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2. Vérifier si l'appelant est bien un 'super_admin'
    const { data: roleCheck } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", caller.id)
      .eq("role", "super_admin")
      .single();

    if (!roleCheck) {
      return new Response(JSON.stringify({ error: "Accès refusé : Droits insuffisants" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 3. Récupérer et valider les données du body
    const { email, password, full_name, role, avatar_url } = await req.json();

    if (!email || !password || !full_name || !role) {
      return new Response(JSON.stringify({ error: "Champs requis manquants" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 4. Création de l'utilisateur via l'API Admin (L'email est auto-confirmé)
    const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name, avatar_url }, // Ajouté ici aussi pour plus de sécurité
    });

    if (createError || !newUser.user) {
      return new Response(JSON.stringify({ error: createError?.message || "Échec de création de l'utilisateur" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 5. Attribution du rôle dans la table personnalisée
    const { error: roleError } = await supabaseAdmin
      .from("user_roles")
      .insert({ user_id: newUser.user.id, role });

    if (roleError) {
      return new Response(JSON.stringify({ error: `Utilisateur créé mais rôle non attribué : ${roleError.message}` }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 6. Mise à jour ou création du profil (utilisation de upsert pour éviter les conflits si un trigger existe)
    if (avatar_url || full_name) {
      await supabaseAdmin
        .from("profiles")
        .upsert({ 
          user_id: newUser.user.id, 
          avatar_url: avatar_url || null,
          full_name: full_name 
        }, { onConflict: 'user_id' });
    }

    return new Response(
      JSON.stringify({ success: true, user_id: newUser.user.id }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Erreur interne";
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
