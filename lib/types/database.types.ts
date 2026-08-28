// Hand-written to match supabase/migrations/*.sql. Once the Supabase project
// exists, regenerate with `supabase gen types typescript --linked` and this
// file becomes the source of truth again - keep the two in sync.

export type ProductStatus = "draft" | "published" | "archived";
export type SubscriptionPlan = "free" | "pro";
// 0013_billing_foundation.sql - confirmed directly from @polar-sh/sdk's
// real SubscriptionStatus type. No "revoked" value - that's an event name
// (subscription.revoked), not a resting status - see that migration's
// comments on apply_subscription_event.
export type SubscriptionStatus =
  | "incomplete"
  | "incomplete_expired"
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "unpaid"
  | "paused";
export type PaymentStatus = "pending" | "succeeded" | "failed" | "refunded";
// FeaturedPlacement/FeaturedStatus removed in 0013 - featured_campaigns is
// dropped and deliberately not recreated until Phase 3D (promotion
// checkout, pending Polar's written confirmation it's acceptable).
export type EntitlementType = "pro_access" | "featured_credit";
export type SeasonStatus = "upcoming" | "active" | "ended";
export type DivisionTier = "elite" | "diamond" | "gold" | "silver" | "bronze";
export type AchievementCategory = "competitive" | "rating" | "product" | "season";
export type AchievementScope = "maker" | "product";

export interface Database {
  public: {
    Tables: {
      makers: {
        Row: {
          id: string;
          username: string;
          display_name: string;
          avatar_url: string | null;
          bio: string | null;
          website_url: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          username: string;
          display_name: string;
          avatar_url?: string | null;
          bio?: string | null;
          website_url?: string | null;
        };
        Update: Partial<{
          username: string;
          display_name: string;
          avatar_url: string | null;
          bio: string | null;
          website_url: string | null;
        }>;
        Relationships: [];
      };
      categories: {
        Row: {
          slug: string;
          name: string;
          description: string | null;
          icon: string | null;
          sort_order: number;
        };
        Insert: {
          slug: string;
          name: string;
          description?: string | null;
          icon?: string | null;
          sort_order?: number;
        };
        Update: Partial<{
          name: string;
          description: string | null;
          icon: string | null;
          sort_order: number;
        }>;
        Relationships: [];
      };
      products: {
        Row: {
          id: string;
          maker_id: string;
          category_slug: string;
          name: string;
          slug: string;
          tagline: string | null;
          description: string;
          website_url: string;
          logo_url: string | null;
          screenshots: string[];
          status: ProductStatus;
          rating: number;
          views: number;
          battles_count: number;
          all_time_rating: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          maker_id: string;
          category_slug: string;
          name: string;
          slug: string;
          tagline?: string | null;
          description: string;
          website_url: string;
          logo_url?: string | null;
          screenshots?: string[];
          status?: ProductStatus;
        };
        Update: Partial<{
          category_slug: string;
          name: string;
          tagline: string | null;
          description: string;
          website_url: string;
          logo_url: string | null;
          screenshots: string[];
          status: ProductStatus;
        }>;
        Relationships: [
          {
            foreignKeyName: "products_maker_id_fkey";
            columns: ["maker_id"];
            isOneToOne: false;
            referencedRelation: "makers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "products_category_slug_fkey";
            columns: ["category_slug"];
            isOneToOne: false;
            referencedRelation: "categories";
            referencedColumns: ["slug"];
          },
        ];
      };
      // 0013_billing_foundation.sql replaced the original placeholder
      // subscriptions/payments/featured_campaigns tables outright (nothing
      // in the app referenced their old shape). featured_campaigns is
      // dropped and deliberately not recreated until Phase 3D.
      webhook_events: {
        Row: {
          id: string;
          provider_event_id: string;
          event_type: string;
          payload: Record<string, unknown>;
          received_at: string;
          processed_at: string | null;
        };
        // The webhook route handler is the only caller (createAdminClient,
        // service_role) - but unlike subscriptions/payments/entitlements
        // below, it calls .insert()/.update() on THIS table directly (it
        // has to, to establish the idempotency gate before any SQL
        // function can run), so real shapes are required here, not never.
        Insert: {
          provider_event_id: string;
          event_type: string;
          payload: Record<string, unknown>;
          received_at?: string;
          processed_at?: string | null;
        };
        Update: Partial<{ processed_at: string | null }>;
        Relationships: [];
      };
      subscriptions: {
        Row: {
          id: string;
          maker_id: string;
          provider_subscription_id: string;
          provider_customer_id: string;
          plan: SubscriptionPlan;
          status: SubscriptionStatus;
          current_period_start: string | null;
          current_period_end: string | null;
          cancel_at_period_end: boolean;
          created_at: string;
          updated_at: string;
        };
        // No app code inserts/updates subscriptions directly - the only
        // write path is apply_subscription_event() via .rpc(), called from
        // the webhook route handler using createAdminClient() (service-
        // role, bypasses RLS).
        Insert: never;
        Update: never;
        Relationships: [
          {
            foreignKeyName: "subscriptions_maker_id_fkey";
            columns: ["maker_id"];
            isOneToOne: false;
            referencedRelation: "makers";
            referencedColumns: ["id"];
          },
        ];
      };
      payments: {
        Row: {
          id: string;
          maker_id: string;
          subscription_id: string | null;
          webhook_event_id: string;
          provider_payment_id: string;
          amount_cents: number;
          currency: string;
          status: PaymentStatus;
          created_at: string;
        };
        // Only write path is apply_order_paid() via .rpc().
        Insert: never;
        Update: never;
        Relationships: [
          {
            foreignKeyName: "payments_maker_id_fkey";
            columns: ["maker_id"];
            isOneToOne: false;
            referencedRelation: "makers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payments_subscription_id_fkey";
            columns: ["subscription_id"];
            isOneToOne: false;
            referencedRelation: "subscriptions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payments_webhook_event_id_fkey";
            columns: ["webhook_event_id"];
            isOneToOne: false;
            referencedRelation: "webhook_events";
            referencedColumns: ["id"];
          },
        ];
      };
      entitlements: {
        Row: {
          id: string;
          maker_id: string;
          type: EntitlementType;
          subscription_id: string | null;
          granted_at: string;
          effective_at: string;
          expires_at: string | null;
          consumed_at: string | null;
          metadata: Record<string, unknown>;
        };
        // Only write path is apply_subscription_event() / apply_order_paid()
        // via .rpc(). consumed_at is set (later, by a 3D feature) through a
        // still-privileged path, not client-writable now either way.
        Insert: never;
        Update: never;
        Relationships: [
          {
            foreignKeyName: "entitlements_maker_id_fkey";
            columns: ["maker_id"];
            isOneToOne: false;
            referencedRelation: "makers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "entitlements_subscription_id_fkey";
            columns: ["subscription_id"];
            isOneToOne: false;
            referencedRelation: "subscriptions";
            referencedColumns: ["id"];
          },
        ];
      };
      votes: {
        Row: {
          id: string;
          voter_id: string | null;
          winner_product_id: string;
          loser_product_id: string;
          winner_rating_before: number;
          loser_rating_before: number;
          winner_rating_after: number;
          loser_rating_after: number;
          season_id: string | null;
          winner_all_time_rating_before: number | null;
          loser_all_time_rating_before: number | null;
          winner_all_time_rating_after: number | null;
          loser_all_time_rating_after: number | null;
          created_at: string;
        };
        // No app code inserts into votes directly - the only write path is
        // the cast_vote() RPC, which is SECURITY DEFINER and bypasses RLS.
        Insert: never;
        Update: never;
        Relationships: [
          {
            foreignKeyName: "votes_voter_id_fkey";
            columns: ["voter_id"];
            isOneToOne: false;
            referencedRelation: "makers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "votes_winner_product_id_fkey";
            columns: ["winner_product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "votes_loser_product_id_fkey";
            columns: ["loser_product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "votes_season_id_fkey";
            columns: ["season_id"];
            isOneToOne: false;
            referencedRelation: "seasons";
            referencedColumns: ["id"];
          },
        ];
      };
      seasons: {
        Row: {
          id: string;
          season_number: number;
          label: string;
          status: SeasonStatus;
          starts_at: string;
          ends_at: string;
          created_at: string;
        };
        // No client write path - all writes happen through
        // run_season_transition() (SECURITY DEFINER, bypasses RLS).
        Insert: never;
        Update: never;
        Relationships: [];
      };
      season_results: {
        Row: {
          id: string;
          season_id: string;
          product_id: string;
          maker_id: string;
          category_slug: string;
          final_rating: number;
          battles_count: number;
          category_rank: number;
          overall_rank: number;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [
          {
            foreignKeyName: "season_results_season_id_fkey";
            columns: ["season_id"];
            isOneToOne: false;
            referencedRelation: "seasons";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "season_results_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "season_results_maker_id_fkey";
            columns: ["maker_id"];
            isOneToOne: false;
            referencedRelation: "makers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "season_results_category_slug_fkey";
            columns: ["category_slug"];
            isOneToOne: false;
            referencedRelation: "categories";
            referencedColumns: ["slug"];
          },
        ];
      };
      achievements: {
        Row: {
          code: string;
          name: string;
          description: string;
          icon: string;
          category: AchievementCategory;
          scope: AchievementScope;
          sort_order: number;
        };
        Insert: {
          code: string;
          name: string;
          description: string;
          icon: string;
          category: AchievementCategory;
          scope: AchievementScope;
          sort_order?: number;
        };
        Update: Partial<{
          name: string;
          description: string;
          icon: string;
          category: AchievementCategory;
          scope: AchievementScope;
          sort_order: number;
        }>;
        Relationships: [];
      };
      maker_achievements: {
        Row: {
          id: string;
          maker_id: string;
          achievement_code: string;
          product_id: string | null;
          season_id: string | null;
          unlocked_at: string;
          metadata: Record<string, unknown>;
        };
        // No app code inserts into maker_achievements directly - the only
        // write paths are check_battle_achievements() / check_product_count_
        // achievements(), both SECURITY DEFINER and bypassing RLS.
        Insert: never;
        Update: never;
        Relationships: [
          {
            foreignKeyName: "maker_achievements_maker_id_fkey";
            columns: ["maker_id"];
            isOneToOne: false;
            referencedRelation: "makers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "maker_achievements_achievement_code_fkey";
            columns: ["achievement_code"];
            isOneToOne: false;
            referencedRelation: "achievements";
            referencedColumns: ["code"];
          },
          {
            foreignKeyName: "maker_achievements_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "maker_achievements_season_id_fkey";
            columns: ["season_id"];
            isOneToOne: false;
            referencedRelation: "seasons";
            referencedColumns: ["id"];
          },
        ];
      };
      maker_ranks: {
        Row: {
          maker_id: string;
          score: number;
          product_component: number;
          competition_component: number;
          history_component: number;
          wins: number;
          battles: number;
          season_wins: number;
          achievements_count: number;
          computed_at: string;
        };
        // No app code inserts into maker_ranks directly - the only write
        // path is recompute_maker_rank() (SECURITY DEFINER, bypasses RLS).
        Insert: never;
        Update: never;
        Relationships: [
          {
            foreignKeyName: "maker_ranks_maker_id_fkey";
            columns: ["maker_id"];
            isOneToOne: true;
            referencedRelation: "makers";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: Record<string, never>;
    Functions: {
      increment_product_views: {
        Args: { p_product_id: string };
        Returns: undefined;
      };
      cast_vote: {
        Args: { p_winner_product_id: string; p_loser_product_id: string };
        Returns: {
          winner_rating_before: number;
          loser_rating_before: number;
          winner_rating_after: number;
          loser_rating_after: number;
          winner_all_time_rating_before: number;
          loser_all_time_rating_before: number;
          winner_all_time_rating_after: number;
          loser_all_time_rating_after: number;
        }[];
      };
      get_random_pairing: {
        Args: { p_viewer_id: string | null; p_category_slug: string | null };
        Returns: {
          id: string;
          name: string;
          slug: string;
          tagline: string | null;
          logo_url: string | null;
          rating: number;
          category_slug: string;
        }[];
      };
      product_divisions: {
        Args: Record<string, never>;
        Returns: {
          product_id: string;
          division: DivisionTier;
          population: number;
          rank_position: number;
        }[];
      };
      check_battle_achievements: {
        Args: { p_maker_id: string; p_product_id: string; p_won: boolean };
        Returns: undefined;
      };
      check_product_count_achievements: {
        Args: { p_maker_id: string };
        Returns: undefined;
      };
      recompute_maker_rank: {
        Args: { p_maker_id: string };
        Returns: undefined;
      };
      maker_rank_positions: {
        Args: Record<string, never>;
        Returns: {
          maker_id: string;
          rank_position: number;
          score: number;
          population: number;
        }[];
      };
      apply_subscription_event: {
        Args: {
          p_maker_id: string;
          p_provider_subscription_id: string;
          p_provider_customer_id: string;
          p_plan: string;
          p_status: string;
          p_current_period_start: string | null;
          p_current_period_end: string | null;
          p_cancel_at_period_end: boolean;
        };
        Returns: string;
      };
      apply_order_paid: {
        Args: {
          p_maker_id: string;
          p_subscription_id: string | null;
          p_provider_payment_id: string;
          p_amount_cents: number;
          p_currency: string;
          p_webhook_event_id: string;
          p_period_start: string | null;
          p_period_end: string | null;
        };
        Returns: string | null;
      };
    };
  };
}
