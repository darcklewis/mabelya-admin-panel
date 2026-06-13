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
    // Variables d'environnement de la Edge Function
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

    // 1. Vérifier la présence du token d'authentification
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Token d'authentification manquant" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    
    const token = authHeader.replace("Bearer ", "");
    const { data: { user: caller }, error: authError } = await supabaseAdmin.auth.getUser(token);
    
    if (authError || !caller) {
      return new Response(JSON.stringify({ error: "Non authentifié ou token invalide" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2. Vérifier si l'appelant est bien un 'super_admin'
    const { data: roleCheck } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", caller.id)
      .eq("role", "super_admin")
      .maybeSingle(); // .maybeSingle() évite de lever une exception si aucun rôle n'est trouvé

    if (!roleCheck) {
      return new Response(JSON.stringify({ error: "Accès refusé : Droits super_admin requis" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 3. Récupérer et valider les données du corps (body)
    const body = await req.json().catch(() => ({}));
    const { email, password, full_name, role, avatar_url } = body;

    if (!email || !password || !full_name || !role) {
      return new Response(JSON.stringify({ error: "Champs requis manquants (email, password, full_name, role)" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 4. Création de l'utilisateur via l'API Admin (Email auto-confirmé)
    const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name, avatar_url },
    });

    if (createError || !newUser?.user) {
      return new Response(JSON.stringify({ error: createError?.message || "Échec de création de l'utilisateur" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const createdUserId = newUser.user.id;

    // 5. Attribution du rôle dans la table user_roles
    const { error: roleError } = await supabaseAdmin
      .from("user_roles")
      .insert({ user_id: createdUserId, role });

    if (roleError) {
      return new Response(JSON.stringify({ error: `Utilisateur créé mais rôle non attribué : ${roleError.message}` }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 6. Mise à jour ou création du profil (Adapté à la structure classique : id est la clé)
    if (avatar_url || full_name) {
      const { error: profileError } = await supabaseAdmin
        .from("profiles")
        .upsert({ 
          id: createdUserId, // 👈 Changé de user_id à id (Clé par défaut de la table profiles sur Supabase)
          avatar_url: avatar_url || null,
          full_name: full_name,
          updated_at: new Date().toISOString()
        }, { onConflict: 'id' });

      if (profileError) {
        console.error("Erreur d'upsert du profil:", profileError.message);
        // On ne bloque pas tout le processus si seul le profil échoue, mais on le loggue.
      }
    }

    return new Response(
      JSON.stringify({ success: true, user_id: createdUserId }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Erreur interne du serveur";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
