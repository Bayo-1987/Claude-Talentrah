export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      ad_campaigns: {
        Row: {
          created_at: string
          created_by: string
          daily_rate_ngn: number
          ends_on: string | null
          id: string
          job_posting_id: string
          last_charged_on: string | null
          name: string
          organization_id: string
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          spent_ngn: number
          starts_on: string
          status: Database["public"]["Enums"]["ad_campaign_status"]
          submitted_at: string | null
          target_employment_type:
            | Database["public"]["Enums"]["employment_type"][]
            | null
          target_locations: string[] | null
          target_seniority:
            | Database["public"]["Enums"]["seniority_level"][]
            | null
          total_budget_ngn: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          daily_rate_ngn: number
          ends_on?: string | null
          id?: string
          job_posting_id: string
          last_charged_on?: string | null
          name: string
          organization_id: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          spent_ngn?: number
          starts_on?: string
          status?: Database["public"]["Enums"]["ad_campaign_status"]
          submitted_at?: string | null
          target_employment_type?:
            | Database["public"]["Enums"]["employment_type"][]
            | null
          target_locations?: string[] | null
          target_seniority?:
            | Database["public"]["Enums"]["seniority_level"][]
            | null
          total_budget_ngn: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          daily_rate_ngn?: number
          ends_on?: string | null
          id?: string
          job_posting_id?: string
          last_charged_on?: string | null
          name?: string
          organization_id?: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          spent_ngn?: number
          starts_on?: string
          status?: Database["public"]["Enums"]["ad_campaign_status"]
          submitted_at?: string | null
          target_employment_type?:
            | Database["public"]["Enums"]["employment_type"][]
            | null
          target_locations?: string[] | null
          target_seniority?:
            | Database["public"]["Enums"]["seniority_level"][]
            | null
          total_budget_ngn?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ad_campaigns_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_campaigns_job_posting_id_fkey"
            columns: ["job_posting_id"]
            isOneToOne: false
            referencedRelation: "job_postings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_campaigns_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_campaigns_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ad_events: {
        Row: {
          campaign_id: string
          dedup_bucket: string
          event_type: Database["public"]["Enums"]["ad_event_type"]
          id: string
          job_posting_id: string
          occurred_at: string
          surface: string
          user_id: string
        }
        Insert: {
          campaign_id: string
          dedup_bucket: string
          event_type: Database["public"]["Enums"]["ad_event_type"]
          id?: string
          job_posting_id: string
          occurred_at?: string
          surface?: string
          user_id: string
        }
        Update: {
          campaign_id?: string
          dedup_bucket?: string
          event_type?: Database["public"]["Enums"]["ad_event_type"]
          id?: string
          job_posting_id?: string
          occurred_at?: string
          surface?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ad_events_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "ad_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_events_job_posting_id_fkey"
            columns: ["job_posting_id"]
            isOneToOne: false
            referencedRelation: "job_postings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ad_wallet_ledger: {
        Row: {
          actor_user_id: string | null
          balance_after_ngn: number
          created_at: string
          delta_ngn: number
          id: string
          organization_id: string
          paystack_reference: string | null
          reason: Database["public"]["Enums"]["ad_wallet_reason"]
          related_entity_id: string | null
        }
        Insert: {
          actor_user_id?: string | null
          balance_after_ngn: number
          created_at?: string
          delta_ngn: number
          id?: string
          organization_id: string
          paystack_reference?: string | null
          reason: Database["public"]["Enums"]["ad_wallet_reason"]
          related_entity_id?: string | null
        }
        Update: {
          actor_user_id?: string | null
          balance_after_ngn?: number
          created_at?: string
          delta_ngn?: number
          id?: string
          organization_id?: string
          paystack_reference?: string | null
          reason?: Database["public"]["Enums"]["ad_wallet_reason"]
          related_entity_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ad_wallet_ledger_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_wallet_ledger_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ad_wallets: {
        Row: {
          balance_ngn: number
          created_at: string
          currency: string
          last_topup_ngn: number | null
          low_balance_notified_at: string | null
          organization_id: string
          updated_at: string
        }
        Insert: {
          balance_ngn?: number
          created_at?: string
          currency?: string
          last_topup_ngn?: number | null
          low_balance_notified_at?: string | null
          organization_id: string
          updated_at?: string
        }
        Update: {
          balance_ngn?: number
          created_at?: string
          currency?: string
          last_topup_ngn?: number | null
          low_balance_notified_at?: string | null
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ad_wallets_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_audit_log: {
        Row: {
          action: string
          admin_email: string | null
          admin_session_id: string | null
          admin_user_id: string | null
          created_at: string
          detail: Json | null
          id: string
          target_id: string | null
          target_table: string | null
        }
        Insert: {
          action: string
          admin_email?: string | null
          admin_session_id?: string | null
          admin_user_id?: string | null
          created_at?: string
          detail?: Json | null
          id?: string
          target_id?: string | null
          target_table?: string | null
        }
        Update: {
          action?: string
          admin_email?: string | null
          admin_session_id?: string | null
          admin_user_id?: string | null
          created_at?: string
          detail?: Json | null
          id?: string
          target_id?: string | null
          target_table?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "admin_audit_log_admin_session_id_fkey"
            columns: ["admin_session_id"]
            isOneToOne: false
            referencedRelation: "admin_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_audit_log_admin_user_id_fkey"
            columns: ["admin_user_id"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_role_permissions: {
        Row: {
          permission: Database["public"]["Enums"]["admin_permission"]
          role_id: string
        }
        Insert: {
          permission: Database["public"]["Enums"]["admin_permission"]
          role_id: string
        }
        Update: {
          permission?: Database["public"]["Enums"]["admin_permission"]
          role_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_role_permissions_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "admin_roles"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_roles: {
        Row: {
          created_at: string
          id: string
          is_builtin: boolean
          name: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_builtin?: boolean
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          is_builtin?: boolean
          name?: string
        }
        Relationships: []
      }
      admin_sessions: {
        Row: {
          admin_user_id: string
          created_at: string
          expires_at: string
          id: string
          ip: string | null
          last_seen_at: string
          revoked_at: string | null
          token_hash: string
          user_agent: string | null
        }
        Insert: {
          admin_user_id: string
          created_at?: string
          expires_at: string
          id?: string
          ip?: string | null
          last_seen_at?: string
          revoked_at?: string | null
          token_hash: string
          user_agent?: string | null
        }
        Update: {
          admin_user_id?: string
          created_at?: string
          expires_at?: string
          id?: string
          ip?: string | null
          last_seen_at?: string
          revoked_at?: string | null
          token_hash?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "admin_sessions_admin_user_id_fkey"
            columns: ["admin_user_id"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_users: {
        Row: {
          created_at: string
          disabled_at: string | null
          display_name: string | null
          email: string
          id: string
          last_login_at: string | null
          role: string
          role_id: string | null
        }
        Insert: {
          created_at?: string
          disabled_at?: string | null
          display_name?: string | null
          email: string
          id: string
          last_login_at?: string | null
          role?: string
          role_id?: string | null
        }
        Update: {
          created_at?: string
          disabled_at?: string | null
          display_name?: string | null
          email?: string
          id?: string
          last_login_at?: string | null
          role?: string
          role_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "admin_users_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "admin_roles"
            referencedColumns: ["id"]
          },
        ]
      }
      anonymous_demo_daily: {
        Row: {
          day: string
          runs: number
        }
        Insert: {
          day: string
          runs?: number
        }
        Update: {
          day?: string
          runs?: number
        }
        Relationships: []
      }
      anonymous_demo_runs: {
        Row: {
          created_at: string
          id: string
          ip_hash: string | null
          visitor_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          ip_hash?: string | null
          visitor_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          ip_hash?: string | null
          visitor_id?: string | null
        }
        Relationships: []
      }
      anonymous_rate_limits: {
        Row: {
          bucket: string
          rate_key: string
          request_count: number
          window_start: string
        }
        Insert: {
          bucket: string
          rate_key: string
          request_count?: number
          window_start: string
        }
        Update: {
          bucket?: string
          rate_key?: string
          request_count?: number
          window_start?: string
        }
        Relationships: []
      }
      api_rate_limits: {
        Row: {
          bucket: string
          request_count: number
          user_id: string
          window_start: string
        }
        Insert: {
          bucket: string
          request_count?: number
          user_id: string
          window_start: string
        }
        Update: {
          bucket?: string
          request_count?: number
          user_id?: string
          window_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "api_rate_limits_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      application_stage_events: {
        Row: {
          application_id: string
          changed_at: string
          id: string
          stage: Database["public"]["Enums"]["application_stage"]
          user_id: string
        }
        Insert: {
          application_id: string
          changed_at?: string
          id?: string
          stage: Database["public"]["Enums"]["application_stage"]
          user_id: string
        }
        Update: {
          application_id?: string
          changed_at?: string
          id?: string
          stage?: Database["public"]["Enums"]["application_stage"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "application_stage_events_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "application_stage_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      applications: {
        Row: {
          applied_at: string | null
          cover_letter_id: string | null
          cover_letter_snapshot: Json | null
          created_at: string
          id: string
          job_posting_id: string | null
          manual_job_snapshot: Json | null
          notes: string | null
          resume_id: string | null
          resume_snapshot: Json | null
          source: Database["public"]["Enums"]["application_source"]
          stage: Database["public"]["Enums"]["application_stage"]
          updated_at: string
          user_id: string
        }
        Insert: {
          applied_at?: string | null
          cover_letter_id?: string | null
          cover_letter_snapshot?: Json | null
          created_at?: string
          id?: string
          job_posting_id?: string | null
          manual_job_snapshot?: Json | null
          notes?: string | null
          resume_id?: string | null
          resume_snapshot?: Json | null
          source?: Database["public"]["Enums"]["application_source"]
          stage?: Database["public"]["Enums"]["application_stage"]
          updated_at?: string
          user_id: string
        }
        Update: {
          applied_at?: string | null
          cover_letter_id?: string | null
          cover_letter_snapshot?: Json | null
          created_at?: string
          id?: string
          job_posting_id?: string | null
          manual_job_snapshot?: Json | null
          notes?: string | null
          resume_id?: string | null
          resume_snapshot?: Json | null
          source?: Database["public"]["Enums"]["application_source"]
          stage?: Database["public"]["Enums"]["application_stage"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "applications_cover_letter_id_fkey"
            columns: ["cover_letter_id"]
            isOneToOne: false
            referencedRelation: "resumes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "applications_job_posting_id_fkey"
            columns: ["job_posting_id"]
            isOneToOne: false
            referencedRelation: "job_postings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "applications_resume_id_fkey"
            columns: ["resume_id"]
            isOneToOne: false
            referencedRelation: "resumes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "applications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      auto_apply_queue: {
        Row: {
          application_id: string | null
          credits_spent: number
          decided_at: string | null
          id: string
          job_posting_id: string
          match_score: number
          queued_at: string
          source_type: Database["public"]["Enums"]["job_source_type"]
          status: Database["public"]["Enums"]["auto_apply_status"]
          tier: string
          user_id: string
        }
        Insert: {
          application_id?: string | null
          credits_spent?: number
          decided_at?: string | null
          id?: string
          job_posting_id: string
          match_score: number
          queued_at?: string
          source_type: Database["public"]["Enums"]["job_source_type"]
          status?: Database["public"]["Enums"]["auto_apply_status"]
          tier: string
          user_id: string
        }
        Update: {
          application_id?: string | null
          credits_spent?: number
          decided_at?: string | null
          id?: string
          job_posting_id?: string
          match_score?: number
          queued_at?: string
          source_type?: Database["public"]["Enums"]["job_source_type"]
          status?: Database["public"]["Enums"]["auto_apply_status"]
          tier?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "auto_apply_queue_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "auto_apply_queue_job_posting_id_fkey"
            columns: ["job_posting_id"]
            isOneToOne: false
            referencedRelation: "job_postings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "auto_apply_queue_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      auto_apply_settings: {
        Row: {
          created_at: string
          enabled: boolean
          enabled_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          enabled_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          enabled_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "auto_apply_settings_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      blog_posts: {
        Row: {
          author: string
          body: string
          created_at: string
          created_by: string | null
          description: string
          id: string
          published_at: string | null
          slug: string
          status: string
          title: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          author: string
          body: string
          created_at?: string
          created_by?: string | null
          description: string
          id?: string
          published_at?: string | null
          slug: string
          status?: string
          title: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          author?: string
          body?: string
          created_at?: string
          created_by?: string | null
          description?: string
          id?: string
          published_at?: string | null
          slug?: string
          status?: string
          title?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "blog_posts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "blog_posts_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "admin_users"
            referencedColumns: ["id"]
          },
        ]
      }
      ci_test_locks: {
        Row: {
          acquired_at: string
          expires_at: string
          holder: string
          name: string
        }
        Insert: {
          acquired_at?: string
          expires_at: string
          holder: string
          name: string
        }
        Update: {
          acquired_at?: string
          expires_at?: string
          holder?: string
          name?: string
        }
        Relationships: []
      }
      country_default_events: {
        Row: {
          country_state: string
          created_at: string
          event_type: string
          id: string
          job_posting_id: string | null
          tab: string | null
          user_id: string
        }
        Insert: {
          country_state: string
          created_at?: string
          event_type: string
          id?: string
          job_posting_id?: string | null
          tab?: string | null
          user_id: string
        }
        Update: {
          country_state?: string
          created_at?: string
          event_type?: string
          id?: string
          job_posting_id?: string | null
          tab?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "country_default_events_job_posting_id_fkey"
            columns: ["job_posting_id"]
            isOneToOne: false
            referencedRelation: "job_postings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "country_default_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      course_recommendation_clicks: {
        Row: {
          clicked_at: string
          id: string
          recommendation_id: string | null
          skill_tag: string
          source: string
          user_id: string | null
        }
        Insert: {
          clicked_at?: string
          id?: string
          recommendation_id?: string | null
          skill_tag: string
          source: string
          user_id?: string | null
        }
        Update: {
          clicked_at?: string
          id?: string
          recommendation_id?: string | null
          skill_tag?: string
          source?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "course_recommendation_clicks_recommendation_id_fkey"
            columns: ["recommendation_id"]
            isOneToOne: false
            referencedRelation: "course_recommendations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "course_recommendation_clicks_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      course_recommendations: {
        Row: {
          active: boolean
          affiliate_url: string
          created_at: string
          id: string
          price_tier: string
          provider: string
          skill_tag: string
          title: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          affiliate_url: string
          created_at?: string
          id?: string
          price_tier: string
          provider: string
          skill_tag: string
          title: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          affiliate_url?: string
          created_at?: string
          id?: string
          price_tier?: string
          provider?: string
          skill_tag?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      credit_gate_events: {
        Row: {
          created_at: string
          credits_available: number
          credits_required: number
          id: string
          outcome: Database["public"]["Enums"]["credit_gate_outcome"]
          reason: Database["public"]["Enums"]["credit_reason"]
          related_entity_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          credits_available: number
          credits_required: number
          id?: string
          outcome: Database["public"]["Enums"]["credit_gate_outcome"]
          reason: Database["public"]["Enums"]["credit_reason"]
          related_entity_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          credits_available?: number
          credits_required?: number
          id?: string
          outcome?: Database["public"]["Enums"]["credit_gate_outcome"]
          reason?: Database["public"]["Enums"]["credit_reason"]
          related_entity_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "credit_gate_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      credit_ledger: {
        Row: {
          balance_after: number
          created_at: string
          delta: number
          id: string
          reason: Database["public"]["Enums"]["credit_reason"]
          related_entity_id: string | null
          user_id: string
        }
        Insert: {
          balance_after: number
          created_at?: string
          delta: number
          id?: string
          reason: Database["public"]["Enums"]["credit_reason"]
          related_entity_id?: string | null
          user_id: string
        }
        Update: {
          balance_after?: number
          created_at?: string
          delta?: number
          id?: string
          reason?: Database["public"]["Enums"]["credit_reason"]
          related_entity_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "credit_ledger_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      credit_packs: {
        Row: {
          credits: number
          id: string
          is_active: boolean
          name: string
          price_ngn: number
        }
        Insert: {
          credits: number
          id?: string
          is_active?: boolean
          name: string
          price_ngn: number
        }
        Update: {
          credits?: number
          id?: string
          is_active?: boolean
          name?: string
          price_ngn?: number
        }
        Relationships: []
      }
      email_preferences: {
        Row: {
          created_at: string
          digest_last_sent_at: string | null
          job_match_digest: boolean
          proactive_match_alert: boolean
          unsubscribe_token: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          digest_last_sent_at?: string | null
          job_match_digest?: boolean
          proactive_match_alert?: boolean
          unsubscribe_token?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          digest_last_sent_at?: string | null
          job_match_digest?: boolean
          proactive_match_alert?: boolean
          unsubscribe_token?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_preferences_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      employer_applicant_status: {
        Row: {
          application_id: string
          first_viewed_at: string | null
          status: Database["public"]["Enums"]["applicant_review_status"]
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          application_id: string
          first_viewed_at?: string | null
          status?: Database["public"]["Enums"]["applicant_review_status"]
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          application_id?: string
          first_viewed_at?: string | null
          status?: Database["public"]["Enums"]["applicant_review_status"]
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "employer_applicant_status_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: true
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employer_applicant_status_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      farah_messages: {
        Row: {
          content: string
          context: Json
          created_at: string
          id: string
          role: Database["public"]["Enums"]["farah_message_role"]
          user_id: string
        }
        Insert: {
          content: string
          context?: Json
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["farah_message_role"]
          user_id: string
        }
        Update: {
          content?: string
          context?: Json
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["farah_message_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "farah_messages_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      farah_session_events: {
        Row: {
          created_at: string
          entry_point: string
          event_type: string
          id: string
          session_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          entry_point: string
          event_type: string
          id?: string
          session_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          entry_point?: string
          event_type?: string
          id?: string
          session_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "farah_session_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      feature_flags: {
        Row: {
          enabled: boolean
          key: string
          label: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          enabled?: boolean
          key: string
          label: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          enabled?: boolean
          key?: string
          label?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "feature_flags_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      feedback: {
        Row: {
          category: Database["public"]["Enums"]["feedback_category"]
          created_at: string
          id: string
          message: string
          page_path: string | null
          status: Database["public"]["Enums"]["feedback_status"]
          triage_note: string | null
          triaged_at: string | null
          triaged_by: string | null
          user_id: string
        }
        Insert: {
          category: Database["public"]["Enums"]["feedback_category"]
          created_at?: string
          id?: string
          message: string
          page_path?: string | null
          status?: Database["public"]["Enums"]["feedback_status"]
          triage_note?: string | null
          triaged_at?: string | null
          triaged_by?: string | null
          user_id: string
        }
        Update: {
          category?: Database["public"]["Enums"]["feedback_category"]
          created_at?: string
          id?: string
          message?: string
          page_path?: string | null
          status?: Database["public"]["Enums"]["feedback_status"]
          triage_note?: string | null
          triaged_at?: string | null
          triaged_by?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "feedback_triaged_by_fkey"
            columns: ["triaged_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feedback_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      job_posting_reports: {
        Row: {
          created_at: string
          details: string | null
          id: string
          job_posting_id: string
          reason: Database["public"]["Enums"]["job_report_reason"]
          reporter_id: string
        }
        Insert: {
          created_at?: string
          details?: string | null
          id?: string
          job_posting_id: string
          reason: Database["public"]["Enums"]["job_report_reason"]
          reporter_id: string
        }
        Update: {
          created_at?: string
          details?: string | null
          id?: string
          job_posting_id?: string
          reason?: Database["public"]["Enums"]["job_report_reason"]
          reporter_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_posting_reports_job_posting_id_fkey"
            columns: ["job_posting_id"]
            isOneToOne: false
            referencedRelation: "job_postings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_posting_reports_reporter_id_fkey"
            columns: ["reporter_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      job_postings: {
        Row: {
          admin_review_decision: string | null
          admin_review_note: string | null
          admin_review_requested_at: string | null
          admin_reviewed_at: string | null
          admin_reviewed_by: string | null
          banner_path: string | null
          claimed_at: string | null
          claimed_by_organization_id: string | null
          closed_at: string | null
          company_logo_url: string | null
          company_name: string
          created_at: string
          dedup_fingerprint: string
          description: string
          description_preview: string
          employment_type: Database["public"]["Enums"]["employment_type"] | null
          expires_at: string | null
          external_source: string | null
          external_url: string | null
          id: string
          last_checked_at: string
          location: string | null
          organization_id: string | null
          posted_at: string
          removal_reason: string | null
          removed_at: string | null
          removed_by: string | null
          salary_currency: string | null
          salary_max: number | null
          salary_min: number | null
          salary_unit: Database["public"]["Enums"]["salary_unit"] | null
          search_vector: unknown
          seniority: Database["public"]["Enums"]["seniority_level"] | null
          source_type: Database["public"]["Enums"]["job_source_type"]
          status: Database["public"]["Enums"]["job_status"]
          structured_jd: Json
          title: string
          unlisted_at: string | null
          work_type: Database["public"]["Enums"]["work_type"] | null
          years_experience_min: number | null
        }
        Insert: {
          admin_review_decision?: string | null
          admin_review_note?: string | null
          admin_review_requested_at?: string | null
          admin_reviewed_at?: string | null
          admin_reviewed_by?: string | null
          banner_path?: string | null
          claimed_at?: string | null
          claimed_by_organization_id?: string | null
          closed_at?: string | null
          company_logo_url?: string | null
          company_name: string
          created_at?: string
          dedup_fingerprint: string
          description: string
          description_preview?: string
          employment_type?:
            | Database["public"]["Enums"]["employment_type"]
            | null
          expires_at?: string | null
          external_source?: string | null
          external_url?: string | null
          id?: string
          last_checked_at?: string
          location?: string | null
          organization_id?: string | null
          posted_at?: string
          removal_reason?: string | null
          removed_at?: string | null
          removed_by?: string | null
          salary_currency?: string | null
          salary_max?: number | null
          salary_min?: number | null
          salary_unit?: Database["public"]["Enums"]["salary_unit"] | null
          search_vector?: unknown
          seniority?: Database["public"]["Enums"]["seniority_level"] | null
          source_type: Database["public"]["Enums"]["job_source_type"]
          status?: Database["public"]["Enums"]["job_status"]
          structured_jd?: Json
          title: string
          unlisted_at?: string | null
          work_type?: Database["public"]["Enums"]["work_type"] | null
          years_experience_min?: number | null
        }
        Update: {
          admin_review_decision?: string | null
          admin_review_note?: string | null
          admin_review_requested_at?: string | null
          admin_reviewed_at?: string | null
          admin_reviewed_by?: string | null
          banner_path?: string | null
          claimed_at?: string | null
          claimed_by_organization_id?: string | null
          closed_at?: string | null
          company_logo_url?: string | null
          company_name?: string
          created_at?: string
          dedup_fingerprint?: string
          description?: string
          description_preview?: string
          employment_type?:
            | Database["public"]["Enums"]["employment_type"]
            | null
          expires_at?: string | null
          external_source?: string | null
          external_url?: string | null
          id?: string
          last_checked_at?: string
          location?: string | null
          organization_id?: string | null
          posted_at?: string
          removal_reason?: string | null
          removed_at?: string | null
          removed_by?: string | null
          salary_currency?: string | null
          salary_max?: number | null
          salary_min?: number | null
          salary_unit?: Database["public"]["Enums"]["salary_unit"] | null
          search_vector?: unknown
          seniority?: Database["public"]["Enums"]["seniority_level"] | null
          source_type?: Database["public"]["Enums"]["job_source_type"]
          status?: Database["public"]["Enums"]["job_status"]
          structured_jd?: Json
          title?: string
          unlisted_at?: string | null
          work_type?: Database["public"]["Enums"]["work_type"] | null
          years_experience_min?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "job_postings_admin_reviewed_by_fkey"
            columns: ["admin_reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_postings_claimed_by_organization_id_fkey"
            columns: ["claimed_by_organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_postings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_postings_removed_by_fkey"
            columns: ["removed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      job_tailoring_requests: {
        Row: {
          created_at: string
          credits_spent: number
          gap_analysis: Json
          id: string
          is_free_trial: boolean
          source_jd_text: string
          source_job_posting_id: string | null
          tailored_cover_letter_id: string | null
          tailored_resume_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          credits_spent?: number
          gap_analysis?: Json
          id?: string
          is_free_trial?: boolean
          source_jd_text: string
          source_job_posting_id?: string | null
          tailored_cover_letter_id?: string | null
          tailored_resume_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          credits_spent?: number
          gap_analysis?: Json
          id?: string
          is_free_trial?: boolean
          source_jd_text?: string
          source_job_posting_id?: string | null
          tailored_cover_letter_id?: string | null
          tailored_resume_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_tailoring_requests_source_job_posting_id_fkey"
            columns: ["source_job_posting_id"]
            isOneToOne: false
            referencedRelation: "job_postings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_tailoring_requests_tailored_cover_letter_id_fkey"
            columns: ["tailored_cover_letter_id"]
            isOneToOne: false
            referencedRelation: "resumes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_tailoring_requests_tailored_resume_id_fkey"
            columns: ["tailored_resume_id"]
            isOneToOne: false
            referencedRelation: "resumes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_tailoring_requests_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      match_scores: {
        Row: {
          computed_at: string
          explanation: Json
          id: string
          job_posting_id: string
          score: number
          tier: string
          user_id: string
        }
        Insert: {
          computed_at?: string
          explanation?: Json
          id?: string
          job_posting_id: string
          score: number
          tier: string
          user_id: string
        }
        Update: {
          computed_at?: string
          explanation?: Json
          id?: string
          job_posting_id?: string
          score?: number
          tier?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "match_scores_job_posting_id_fkey"
            columns: ["job_posting_id"]
            isOneToOne: false
            referencedRelation: "job_postings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_scores_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      mentor_availability_slots: {
        Row: {
          created_at: string
          end_at: string
          id: string
          is_booked: boolean
          mentor_id: string
          start_at: string
        }
        Insert: {
          created_at?: string
          end_at: string
          id?: string
          is_booked?: boolean
          mentor_id: string
          start_at: string
        }
        Update: {
          created_at?: string
          end_at?: string
          id?: string
          is_booked?: boolean
          mentor_id?: string
          start_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "mentor_availability_slots_mentor_id_fkey"
            columns: ["mentor_id"]
            isOneToOne: false
            referencedRelation: "mentor_profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      mentor_profiles: {
        Row: {
          applied_at: string
          base_price_ngn: number | null
          bio: string | null
          expertise_industries: string[]
          expertise_roles: string[]
          expertise_seniority: Database["public"]["Enums"]["seniority_level"][]
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          user_id: string
          years_experience: number | null
        }
        Insert: {
          applied_at?: string
          base_price_ngn?: number | null
          bio?: string | null
          expertise_industries?: string[]
          expertise_roles?: string[]
          expertise_seniority?: Database["public"]["Enums"]["seniority_level"][]
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          user_id: string
          years_experience?: number | null
        }
        Update: {
          applied_at?: string
          base_price_ngn?: number | null
          bio?: string | null
          expertise_industries?: string[]
          expertise_roles?: string[]
          expertise_seniority?: Database["public"]["Enums"]["seniority_level"][]
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          user_id?: string
          years_experience?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "mentor_profiles_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mentor_profiles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      mentorship_reviews: {
        Row: {
          created_at: string
          id: string
          mentor_id: string
          rating: number
          review_text: string | null
          reviewer_id: string
          session_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          mentor_id: string
          rating: number
          review_text?: string | null
          reviewer_id: string
          session_id: string
        }
        Update: {
          created_at?: string
          id?: string
          mentor_id?: string
          rating?: number
          review_text?: string | null
          reviewer_id?: string
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mentorship_reviews_mentor_id_fkey"
            columns: ["mentor_id"]
            isOneToOne: false
            referencedRelation: "mentor_profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "mentorship_reviews_reviewer_id_fkey"
            columns: ["reviewer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mentorship_reviews_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: true
            referencedRelation: "mentorship_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      mentorship_sessions: {
        Row: {
          availability_slot_id: string
          created_at: string
          id: string
          meeting_link: string | null
          mentee_id: string
          mentee_notes: string | null
          mentor_confirmed_at: string | null
          mentor_id: string
          mentor_notes: string | null
          mentor_payout_ngn: number
          platform_commission_ngn: number
          price_ngn: number
          scheduled_end: string
          scheduled_start: string
          session_type: string
          status: string
          updated_at: string
        }
        Insert: {
          availability_slot_id: string
          created_at?: string
          id?: string
          meeting_link?: string | null
          mentee_id: string
          mentee_notes?: string | null
          mentor_confirmed_at?: string | null
          mentor_id: string
          mentor_notes?: string | null
          mentor_payout_ngn?: number
          platform_commission_ngn?: number
          price_ngn?: number
          scheduled_end: string
          scheduled_start: string
          session_type: string
          status?: string
          updated_at?: string
        }
        Update: {
          availability_slot_id?: string
          created_at?: string
          id?: string
          meeting_link?: string | null
          mentee_id?: string
          mentee_notes?: string | null
          mentor_confirmed_at?: string | null
          mentor_id?: string
          mentor_notes?: string | null
          mentor_payout_ngn?: number
          platform_commission_ngn?: number
          price_ngn?: number
          scheduled_end?: string
          scheduled_start?: string
          session_type?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "mentorship_sessions_availability_slot_id_fkey"
            columns: ["availability_slot_id"]
            isOneToOne: true
            referencedRelation: "mentor_availability_slots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mentorship_sessions_mentee_id_fkey"
            columns: ["mentee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mentorship_sessions_mentor_id_fkey"
            columns: ["mentor_id"]
            isOneToOne: false
            referencedRelation: "mentor_profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      organization_members: {
        Row: {
          created_at: string
          organization_id: string
          role: Database["public"]["Enums"]["org_member_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          organization_id: string
          role?: Database["public"]["Enums"]["org_member_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          organization_id?: string
          role?: Database["public"]["Enums"]["org_member_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_members_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          cac_business_name: string | null
          cac_confirmed_at: string | null
          cac_confirmed_by: string | null
          cac_number: string | null
          claim_review_dismissed_at: string | null
          created_at: string
          created_by: string
          description: string | null
          domain: string | null
          id: string
          logo_url: string | null
          name: string
          updated_at: string
          verification_reminder_48h_sent_at: string | null
          verification_reminder_7d_sent_at: string | null
          verified: boolean
        }
        Insert: {
          cac_business_name?: string | null
          cac_confirmed_at?: string | null
          cac_confirmed_by?: string | null
          cac_number?: string | null
          claim_review_dismissed_at?: string | null
          created_at?: string
          created_by: string
          description?: string | null
          domain?: string | null
          id?: string
          logo_url?: string | null
          name: string
          updated_at?: string
          verification_reminder_48h_sent_at?: string | null
          verification_reminder_7d_sent_at?: string | null
          verified?: boolean
        }
        Update: {
          cac_business_name?: string | null
          cac_confirmed_at?: string | null
          cac_confirmed_by?: string | null
          cac_number?: string | null
          claim_review_dismissed_at?: string | null
          created_at?: string
          created_by?: string
          description?: string | null
          domain?: string | null
          id?: string
          logo_url?: string | null
          name?: string
          updated_at?: string
          verification_reminder_48h_sent_at?: string | null
          verification_reminder_7d_sent_at?: string | null
          verified?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "organizations_cac_confirmed_by_fkey"
            columns: ["cac_confirmed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organizations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      passes: {
        Row: {
          duration_days: number
          id: string
          is_active: boolean
          name: string
          price_ngn: number
        }
        Insert: {
          duration_days: number
          id?: string
          is_active?: boolean
          name: string
          price_ngn: number
        }
        Update: {
          duration_days?: number
          id?: string
          is_active?: boolean
          name?: string
          price_ngn?: number
        }
        Relationships: []
      }
      payment_transactions: {
        Row: {
          amount: number
          authorization_code: string | null
          channel: string | null
          created_at: string
          currency: string
          id: string
          organization_id: string | null
          paystack_reference: string | null
          product_id: string | null
          product_type: Database["public"]["Enums"]["payment_product_type"]
          rail: string
          renewal_for_pass_id: string | null
          status: Database["public"]["Enums"]["payment_status"]
          user_id: string
        }
        Insert: {
          amount: number
          authorization_code?: string | null
          channel?: string | null
          created_at?: string
          currency?: string
          id?: string
          organization_id?: string | null
          paystack_reference?: string | null
          product_id?: string | null
          product_type: Database["public"]["Enums"]["payment_product_type"]
          rail?: string
          renewal_for_pass_id?: string | null
          status?: Database["public"]["Enums"]["payment_status"]
          user_id: string
        }
        Update: {
          amount?: number
          authorization_code?: string | null
          channel?: string | null
          created_at?: string
          currency?: string
          id?: string
          organization_id?: string | null
          paystack_reference?: string | null
          product_id?: string | null
          product_type?: Database["public"]["Enums"]["payment_product_type"]
          rail?: string
          renewal_for_pass_id?: string | null
          status?: Database["public"]["Enums"]["payment_status"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_transactions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_transactions_renewal_for_pass_id_fkey"
            columns: ["renewal_for_pass_id"]
            isOneToOne: false
            referencedRelation: "user_passes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_transactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      proactive_match_alerts: {
        Row: {
          job_posting_id: string
          score: number
          sent_at: string
          user_id: string
        }
        Insert: {
          job_posting_id: string
          score: number
          sent_at?: string
          user_id: string
        }
        Update: {
          job_posting_id?: string
          score?: number
          sent_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "proactive_match_alerts_job_posting_id_fkey"
            columns: ["job_posting_id"]
            isOneToOne: false
            referencedRelation: "job_postings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proactive_match_alerts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          country: string | null
          created_at: string
          credits_balance: number
          email: string
          farah_hint_dismissed_at: string | null
          first_name: string | null
          free_trial_cover_letter_used: boolean
          free_trial_tailoring_used: boolean
          id: string
          last_name: string | null
          locale: string
          market_segment: Database["public"]["Enums"]["market_segment"]
          onboarding_skipped_at: string | null
          referral_code: string
          referral_leaderboard_display_name: string | null
          referral_leaderboard_opt_in: boolean
          referred_by: string | null
          resume_skills_notice_dismissed_at: string | null
          updated_at: string
        }
        Insert: {
          country?: string | null
          created_at?: string
          credits_balance?: number
          email: string
          farah_hint_dismissed_at?: string | null
          first_name?: string | null
          free_trial_cover_letter_used?: boolean
          free_trial_tailoring_used?: boolean
          id: string
          last_name?: string | null
          locale?: string
          market_segment?: Database["public"]["Enums"]["market_segment"]
          onboarding_skipped_at?: string | null
          referral_code: string
          referral_leaderboard_display_name?: string | null
          referral_leaderboard_opt_in?: boolean
          referred_by?: string | null
          resume_skills_notice_dismissed_at?: string | null
          updated_at?: string
        }
        Update: {
          country?: string | null
          created_at?: string
          credits_balance?: number
          email?: string
          farah_hint_dismissed_at?: string | null
          first_name?: string | null
          free_trial_cover_letter_used?: boolean
          free_trial_tailoring_used?: boolean
          id?: string
          last_name?: string | null
          locale?: string
          market_segment?: Database["public"]["Enums"]["market_segment"]
          onboarding_skipped_at?: string | null
          referral_code?: string
          referral_leaderboard_display_name?: string | null
          referral_leaderboard_opt_in?: boolean
          referred_by?: string | null
          resume_skills_notice_dismissed_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_referred_by_fkey"
            columns: ["referred_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      referral_shares: {
        Row: {
          channel: string
          created_at: string
          id: string
          surface: string
          user_id: string
        }
        Insert: {
          channel: string
          created_at?: string
          id?: string
          surface?: string
          user_id: string
        }
        Update: {
          channel?: string
          created_at?: string
          id?: string
          surface?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "referral_shares_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      referrals: {
        Row: {
          activated_at: string | null
          created_at: string
          id: string
          referred_user_id: string | null
          referrer_id: string
          reward_credits_referred: number
          reward_credits_referrer: number
          signed_up_at: string | null
          status: Database["public"]["Enums"]["referral_status"]
        }
        Insert: {
          activated_at?: string | null
          created_at?: string
          id?: string
          referred_user_id?: string | null
          referrer_id: string
          reward_credits_referred?: number
          reward_credits_referrer?: number
          signed_up_at?: string | null
          status?: Database["public"]["Enums"]["referral_status"]
        }
        Update: {
          activated_at?: string | null
          created_at?: string
          id?: string
          referred_user_id?: string | null
          referrer_id?: string
          reward_credits_referred?: number
          reward_credits_referrer?: number
          signed_up_at?: string | null
          status?: Database["public"]["Enums"]["referral_status"]
        }
        Relationships: [
          {
            foreignKeyName: "referrals_referred_user_id_fkey"
            columns: ["referred_user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referrals_referrer_id_fkey"
            columns: ["referrer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      resume_builder_start_events: {
        Row: {
          created_at: string
          event_type: string
          id: string
          resume_id: string | null
          start_state: string
          user_id: string
        }
        Insert: {
          created_at?: string
          event_type: string
          id?: string
          resume_id?: string | null
          start_state: string
          user_id: string
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: string
          resume_id?: string | null
          start_state?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "resume_builder_start_events_resume_id_fkey"
            columns: ["resume_id"]
            isOneToOne: false
            referencedRelation: "resumes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resume_builder_start_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      resume_templates: {
        Row: {
          ats_safe: boolean
          created_at: string
          id: string
          industry_category: string
          is_premium: boolean
          name: string
          preview_asset_url: string | null
          slug: string
          structure_schema: Json
          unlock_cost_credits: number
        }
        Insert: {
          ats_safe?: boolean
          created_at?: string
          id?: string
          industry_category: string
          is_premium?: boolean
          name: string
          preview_asset_url?: string | null
          slug: string
          structure_schema?: Json
          unlock_cost_credits?: number
        }
        Update: {
          ats_safe?: boolean
          created_at?: string
          id?: string
          industry_category?: string
          is_premium?: boolean
          name?: string
          preview_asset_url?: string | null
          slug?: string
          structure_schema?: Json
          unlock_cost_credits?: number
        }
        Relationships: []
      }
      resumes: {
        Row: {
          created_at: string
          id: string
          is_base: boolean
          parse_confidence: string | null
          source: Database["public"]["Enums"]["resume_source"]
          structured_content: Json
          tailored_for_job_id: string | null
          template_id: string | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_base?: boolean
          parse_confidence?: string | null
          source?: Database["public"]["Enums"]["resume_source"]
          structured_content?: Json
          tailored_for_job_id?: string | null
          template_id?: string | null
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_base?: boolean
          parse_confidence?: string | null
          source?: Database["public"]["Enums"]["resume_source"]
          structured_content?: Json
          tailored_for_job_id?: string | null
          template_id?: string | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "resumes_tailored_for_job_id_fkey"
            columns: ["tailored_for_job_id"]
            isOneToOne: false
            referencedRelation: "job_postings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resumes_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "resume_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resumes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      scholarship_saves: {
        Row: {
          created_at: string
          id: string
          notes: string | null
          outcome_note: string | null
          scholarship_id: string
          status: Database["public"]["Enums"]["scholarship_save_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          notes?: string | null
          outcome_note?: string | null
          scholarship_id: string
          status?: Database["public"]["Enums"]["scholarship_save_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          notes?: string | null
          outcome_note?: string | null
          scholarship_id?: string
          status?: Database["public"]["Enums"]["scholarship_save_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "scholarship_saves_scholarship_id_fkey"
            columns: ["scholarship_id"]
            isOneToOne: false
            referencedRelation: "scholarships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scholarship_saves_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      scholarships: {
        Row: {
          application_deadline: string | null
          created_at: string
          cycle_year: number | null
          deadline_note: string | null
          deadline_verified_at: string | null
          dedup_fingerprint: string
          degree_levels: Database["public"]["Enums"]["scholarship_degree_level"][]
          eligibility_age: string | null
          eligibility_nationalities: string[]
          eligibility_other: string | null
          eligibility_prior_degree: string | null
          field_tags: string[]
          funding_covers: string[]
          funding_type: Database["public"]["Enums"]["scholarship_funding_type"]
          host_institution: string | null
          id: string
          last_checked_at: string
          moderated_at: string | null
          moderated_by: string | null
          moderation_note: string | null
          moderation_status: Database["public"]["Enums"]["scholarship_moderation_status"]
          official_url: string
          program_name: string
          provider: string
          source_name: string | null
          updated_at: string
        }
        Insert: {
          application_deadline?: string | null
          created_at?: string
          cycle_year?: number | null
          deadline_note?: string | null
          deadline_verified_at?: string | null
          dedup_fingerprint: string
          degree_levels?: Database["public"]["Enums"]["scholarship_degree_level"][]
          eligibility_age?: string | null
          eligibility_nationalities?: string[]
          eligibility_other?: string | null
          eligibility_prior_degree?: string | null
          field_tags?: string[]
          funding_covers?: string[]
          funding_type: Database["public"]["Enums"]["scholarship_funding_type"]
          host_institution?: string | null
          id?: string
          last_checked_at?: string
          moderated_at?: string | null
          moderated_by?: string | null
          moderation_note?: string | null
          moderation_status?: Database["public"]["Enums"]["scholarship_moderation_status"]
          official_url: string
          program_name: string
          provider: string
          source_name?: string | null
          updated_at?: string
        }
        Update: {
          application_deadline?: string | null
          created_at?: string
          cycle_year?: number | null
          deadline_note?: string | null
          deadline_verified_at?: string | null
          dedup_fingerprint?: string
          degree_levels?: Database["public"]["Enums"]["scholarship_degree_level"][]
          eligibility_age?: string | null
          eligibility_nationalities?: string[]
          eligibility_other?: string | null
          eligibility_prior_degree?: string | null
          field_tags?: string[]
          funding_covers?: string[]
          funding_type?: Database["public"]["Enums"]["scholarship_funding_type"]
          host_institution?: string | null
          id?: string
          last_checked_at?: string
          moderated_at?: string | null
          moderated_by?: string | null
          moderation_note?: string | null
          moderation_status?: Database["public"]["Enums"]["scholarship_moderation_status"]
          official_url?: string
          program_name?: string
          provider?: string
          source_name?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "scholarships_moderated_by_fkey"
            columns: ["moderated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_notifications: {
        Row: {
          body: string
          created_at: string
          id: string
          link: string | null
          read_at: string | null
          title: string
          type: string
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          link?: string | null
          read_at?: string | null
          title: string
          type: string
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          link?: string | null
          read_at?: string | null
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_passes: {
        Row: {
          authorization_code: string | null
          auto_renew: boolean
          auto_renew_status:
            | Database["public"]["Enums"]["pass_auto_renew_status"]
            | null
          created_at: string
          expires_at: string
          id: string
          last_renewal_failure_at: string | null
          next_renewal_date: string | null
          pass_id: string
          payment_method: Database["public"]["Enums"]["pass_payment_method"]
          payment_transaction_id: string | null
          pending_renewal_reference: string | null
          renewal_attempt_count: number
          renewal_reminder_sent_at: string | null
          started_at: string
          status: string
          user_id: string
        }
        Insert: {
          authorization_code?: string | null
          auto_renew?: boolean
          auto_renew_status?:
            | Database["public"]["Enums"]["pass_auto_renew_status"]
            | null
          created_at?: string
          expires_at: string
          id?: string
          last_renewal_failure_at?: string | null
          next_renewal_date?: string | null
          pass_id: string
          payment_method: Database["public"]["Enums"]["pass_payment_method"]
          payment_transaction_id?: string | null
          pending_renewal_reference?: string | null
          renewal_attempt_count?: number
          renewal_reminder_sent_at?: string | null
          started_at?: string
          status?: string
          user_id: string
        }
        Update: {
          authorization_code?: string | null
          auto_renew?: boolean
          auto_renew_status?:
            | Database["public"]["Enums"]["pass_auto_renew_status"]
            | null
          created_at?: string
          expires_at?: string
          id?: string
          last_renewal_failure_at?: string | null
          next_renewal_date?: string | null
          pass_id?: string
          payment_method?: Database["public"]["Enums"]["pass_payment_method"]
          payment_transaction_id?: string | null
          pending_renewal_reference?: string | null
          renewal_attempt_count?: number
          renewal_reminder_sent_at?: string | null
          started_at?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_passes_pass_id_fkey"
            columns: ["pass_id"]
            isOneToOne: false
            referencedRelation: "passes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_passes_payment_transaction_id_fkey"
            columns: ["payment_transaction_id"]
            isOneToOne: false
            referencedRelation: "payment_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_passes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_template_unlocks: {
        Row: {
          id: string
          template_id: string
          unlocked_at: string
          user_id: string
        }
        Insert: {
          id?: string
          template_id: string
          unlocked_at?: string
          user_id: string
        }
        Update: {
          id?: string
          template_id?: string
          unlocked_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_template_unlocks_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "resume_templates"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_create_operator: {
        Args: {
          p_actor: string
          p_display_name: string
          p_email: string
          p_role_id: string
          p_user_id: string
        }
        Returns: {
          ok: boolean
          reason: string
        }[]
      }
      admin_delete_role: {
        Args: { p_actor: string; p_role_id: string }
        Returns: {
          ok: boolean
          reason: string
        }[]
      }
      admin_has_permission: {
        Args: {
          p_admin: string
          p_permission: Database["public"]["Enums"]["admin_permission"]
        }
        Returns: boolean
      }
      admin_moderate_job_posting: {
        Args: {
          p_action: string
          p_actor: string
          p_id: string
          p_reason: string
        }
        Returns: {
          new_status: string
          ok: boolean
          reason: string
        }[]
      }
      admin_moderate_mentor_application: {
        Args: {
          p_actor: string
          p_decision: string
          p_mentor_user_id: string
          p_note: string
        }
        Returns: {
          ok: boolean
          reason: string
        }[]
      }
      admin_moderate_scholarship: {
        Args: {
          p_actor: string
          p_id: string
          p_note: string
          p_status: string
        }
        Returns: {
          ok: boolean
          reason: string
        }[]
      }
      admin_operators_covered: { Args: never; Returns: boolean }
      admin_permission_catalog: {
        Args: never
        Returns: {
          permission: Database["public"]["Enums"]["admin_permission"]
        }[]
      }
      admin_session_validate: {
        Args: { p_token_hash: string }
        Returns: {
          admin_display_name: string
          admin_email: string
          admin_id: string
          session_expires_at: string
          session_id: string
        }[]
      }
      admin_set_feature_flag: {
        Args: { p_actor: string; p_enabled: boolean; p_key: string }
        Returns: {
          ok: boolean
          reason: string
        }[]
      }
      admin_set_operator: {
        Args: {
          p_actor: string
          p_disabled?: boolean
          p_role_id?: string
          p_target: string
        }
        Returns: {
          ok: boolean
          reason: string
        }[]
      }
      admin_triage_feedback: {
        Args: {
          p_actor: string
          p_id: string
          p_note: string
          p_status: string
        }
        Returns: {
          ok: boolean
          reason: string
        }[]
      }
      admin_update_course: {
        Args: {
          p_active?: boolean
          p_actor: string
          p_affiliate_url?: string
          p_id: string
          p_price_tier?: string
          p_provider?: string
          p_skill_tag?: string
          p_title?: string
        }
        Returns: {
          ok: boolean
          reason: string
        }[]
      }
      admin_update_operator: {
        Args: {
          p_actor: string
          p_disabled?: boolean
          p_role?: string
          p_target: string
        }
        Returns: {
          new_disabled_at: string
          new_role: string
          ok: boolean
          reason: string
        }[]
      }
      admin_upsert_role: {
        Args: {
          p_actor: string
          p_name: string
          p_permissions: Database["public"]["Enums"]["admin_permission"][]
          p_role_id: string
        }
        Returns: {
          ok: boolean
          reason: string
          role_id: string
        }[]
      }
      auto_apply_claim_submission: {
        Args: {
          p_credit_cost: number
          p_daily_cap: number
          p_free_per_week: number
          p_has_active_pass?: boolean
          p_min_score: number
          p_queue_id: string
          p_user_id: string
        }
        Returns: {
          charge: number
          job_posting_id: string
          ok: boolean
          pass_covered: boolean
          reason: string
          source_type: Database["public"]["Enums"]["job_source_type"]
        }[]
      }
      book_mentor_session: {
        Args: {
          p_availability_slot_id: string
          p_mentee_id: string
          p_session_type: string
        }
        Returns: {
          mentor_id: string
          price_ngn: number
          session_id: string
        }[]
      }
      charge_ad_campaign_day: {
        Args: { p_campaign_id: string; p_on_date?: string }
        Returns: {
          balance_after_ngn: number
          ok: boolean
          status: Database["public"]["Enums"]["ad_campaign_status"]
        }[]
      }
      check_and_activate_referral: {
        Args: { p_user_id: string }
        Returns: undefined
      }
      ci_test_lock_acquire: {
        Args: { p_holder: string; p_name: string; p_ttl_seconds?: number }
        Returns: boolean
      }
      ci_test_lock_release: {
        Args: { p_holder: string; p_name: string }
        Returns: boolean
      }
      claim_anonymous_demo_run: {
        Args: { p_daily_cap: number; p_ip_hash: string; p_visitor_id: string }
        Returns: {
          allowed: boolean
          reason: string
        }[]
      }
      claim_external_job_posting: {
        Args: {
          p_description: string
          p_external_job_posting_id: string
          p_location: string
          p_organization_id: string
          p_title: string
        }
        Returns: {
          job_posting_id: string
          ok: boolean
          reason: string
        }[]
      }
      consume_anonymous_rate_limit: {
        Args: {
          p_bucket: string
          p_key: string
          p_limit: number
          p_window_seconds: number
        }
        Returns: {
          allowed: boolean
          resets_at: string
          used: number
        }[]
      }
      consume_rate_limit: {
        Args: {
          p_bucket: string
          p_limit: number
          p_user_id: string
          p_window_seconds: number
        }
        Returns: {
          allowed: boolean
          resets_at: string
          used: number
        }[]
      }
      count_rewarded_referrals_last_30d: {
        Args: { p_exclude_referral_id?: string; p_referrer_id: string }
        Returns: number
      }
      credit_ad_wallet: {
        Args: {
          p_actor_user_id?: string
          p_amount_ngn: number
          p_organization_id: string
          p_paystack_reference?: string
          p_reason?: Database["public"]["Enums"]["ad_wallet_reason"]
        }
        Returns: {
          already_applied: boolean
          balance_after_ngn: number
          ok: boolean
        }[]
      }
      debit_ad_wallet: {
        Args: {
          p_actor_user_id?: string
          p_amount_ngn: number
          p_organization_id: string
          p_reason?: Database["public"]["Enums"]["ad_wallet_reason"]
          p_related_entity_id?: string
        }
        Returns: {
          balance_after_ngn: number
          low_balance: boolean
          ok: boolean
        }[]
      }
      delete_resume_with_snapshot: {
        Args: { p_resume_id: string; p_user_id: string }
        Returns: {
          applications_snapshotted: number
          ok: boolean
          reason: string
        }[]
      }
      email_unsubscribe: {
        Args: { p_subscribed?: boolean; p_token: string }
        Returns: {
          job_match_digest: boolean
          matched: boolean
        }[]
      }
      employer_job_applicants: {
        Args: { p_job_posting_id: string }
        Returns: {
          application_id: string
          applied_at: string
          first_name: string
          last_name: string
          resume_id: string
          status: Database["public"]["Enums"]["applicant_review_status"]
        }[]
      }
      employer_view_resume: {
        Args: { p_application_id: string }
        Returns: {
          structured_content: Json
          template_slug: string
        }[]
      }
      generate_referral_code: { Args: never; Returns: string }
      grant_referral_reward: {
        Args: {
          p_amount: number
          p_reason: Database["public"]["Enums"]["credit_reason"]
          p_referral_id: string
          p_referrer_id: string
        }
        Returns: undefined
      }
      has_visible_characters: { Args: { value: string }; Returns: boolean }
      internal_applicant_counts: {
        Args: { p_job_ids: string[] }
        Returns: {
          applicant_count: number
          job_posting_id: string
        }[]
      }
      is_org_member: { Args: { p_organization_id: string }; Returns: boolean }
      is_org_member_for_application: {
        Args: { p_application_id: string }
        Returns: boolean
      }
      is_valid_referral_code: { Args: { p_code: string }; Returns: boolean }
      job_posting_claim_candidates: {
        Args: { p_organization_id: string }
        Returns: {
          company_name: string
          confidence: string
          external_source: string
          external_url: string
          id: string
          location: string
          posted_at: string
          title: string
        }[]
      }
      job_posting_external_host: { Args: { p_url: string }; Returns: string }
      list_applied_migrations: {
        Args: never
        Returns: {
          name: string
        }[]
      }
      mark_mentor_session_confirmed: {
        Args: {
          p_meeting_link: string
          p_mentor_id: string
          p_session_id: string
        }
        Returns: boolean
      }
      normalize_company_name: { Args: { p_name: string }; Returns: string }
      normalize_email_for_self_referral: {
        Args: { p_email: string }
        Returns: string
      }
      operator_credential_events: {
        Args: { p_since?: string }
        Returns: {
          event_action: string
          event_ip: string
          occurred_at: string
          operator_email: string
          operator_id: string
        }[]
      }
      org_application_counts: {
        Args: { p_organization_id: string }
        Returns: {
          application_count: number
          job_posting_id: string
        }[]
      }
      pause_ad_campaign: {
        Args: { p_campaign_id: string }
        Returns: Database["public"]["Enums"]["ad_campaign_status"]
      }
      proactive_match_alert_set_preference: {
        Args: { p_enabled?: boolean; p_token: string }
        Returns: {
          matched: boolean
          proactive_match_alert: boolean
        }[]
      }
      promoted_jobs: {
        Args: {
          p_limit?: number
          p_min_score?: number
          p_seniorities?: Database["public"]["Enums"]["seniority_level"][]
          p_work_types?: Database["public"]["Enums"]["work_type"][]
        }
        Returns: {
          campaign_id: string
          job_posting_id: string
          match_score: number
        }[]
      }
      record_ad_event: {
        Args: {
          p_campaign_id: string
          p_event_type: Database["public"]["Enums"]["ad_event_type"]
          p_job_posting_id: string
          p_surface?: string
          p_user_id: string
        }
        Returns: boolean
      }
      record_employer_resume_view: {
        Args: { p_application_id: string }
        Returns: undefined
      }
      referral_leaderboard: {
        Args: { p_limit?: number; p_period_end: string; p_period_start: string }
        Returns: {
          activated_count: number
          display_name: string
          rank: number
        }[]
      }
      release_anonymous_demo_run: {
        Args: { p_ip_hash: string; p_visitor_id: string }
        Returns: undefined
      }
      resume_ad_campaign: {
        Args: { p_actor_user_id?: string; p_campaign_id: string }
        Returns: {
          balance_after_ngn: number
          ok: boolean
          status: Database["public"]["Enums"]["ad_campaign_status"]
        }[]
      }
      search_job_postings: {
        Args: {
          p_ids?: string[]
          p_query: string
          p_seniorities?: Database["public"]["Enums"]["seniority_level"][]
          p_since: string
          p_source_type?: Database["public"]["Enums"]["job_source_type"]
          p_work_types?: Database["public"]["Enums"]["work_type"][]
        }
        Returns: {
          company_logo_url: string
          company_name: string
          created_at: string
          dedup_fingerprint: string
          description: string
          employment_type: Database["public"]["Enums"]["employment_type"]
          expires_at: string
          external_source: string
          external_url: string
          id: string
          last_checked_at: string
          location: string
          organization_id: string
          posted_at: string
          rank: number
          removal_reason: string
          removed_at: string
          removed_by: string
          salary_currency: string
          salary_max: number
          salary_min: number
          salary_unit: Database["public"]["Enums"]["salary_unit"]
          seniority: Database["public"]["Enums"]["seniority_level"]
          source_type: Database["public"]["Enums"]["job_source_type"]
          status: Database["public"]["Enums"]["job_status"]
          structured_jd: Json
          title: string
          work_type: Database["public"]["Enums"]["work_type"]
          years_experience_min: number
        }[]
      }
      seeker_application_view_status: {
        Args: { p_application_ids: string[] }
        Returns: {
          application_id: string
          first_viewed_at: string
        }[]
      }
      set_ad_campaign_review: {
        Args: {
          p_approve: boolean
          p_campaign_id: string
          p_note?: string
          p_reviewer_id: string
        }
        Returns: Database["public"]["Enums"]["ad_campaign_status"]
      }
      spend_credits_atomic: {
        Args: {
          p_amount: number
          p_reason: Database["public"]["Enums"]["credit_reason"]
          p_related_entity_id?: string
          p_user_id: string
        }
        Returns: {
          balance_after: number
          ok: boolean
        }[]
      }
      storage_bucket_usage: {
        Args: never
        Returns: {
          bucket_id: string
          bytes: number
          is_public: boolean
          object_count: number
        }[]
      }
      submit_ad_campaign_for_review: {
        Args: { p_actor_user_id: string; p_campaign_id: string }
        Returns: Database["public"]["Enums"]["ad_campaign_status"]
      }
    }
    Enums: {
      ad_campaign_status:
        | "draft"
        | "pending_review"
        | "rejected"
        | "active"
        | "paused_by_employer"
        | "paused_insufficient_funds"
        | "completed"
      ad_event_type: "impression" | "click" | "apply"
      ad_wallet_reason:
        | "topup"
        | "campaign_charge"
        | "admin_adjustment"
        | "reversal"
      admin_permission:
        | "scholarships"
        | "reported_postings"
        | "ad_campaigns"
        | "feedback"
        | "courses"
        | "operations"
        | "finance"
        | "people"
        | "operators"
        | "blog"
        | "feature_flags"
        | "people_list"
        | "employer_verification"
        | "job_review"
        | "mentor_review"
      applicant_review_status:
        | "new"
        | "reviewing"
        | "shortlisted"
        | "interviewing"
        | "hired"
        | "not_a_fit"
      application_source: "internal_apply" | "manual" | "auto_apply"
      application_stage:
        | "saved"
        | "applied"
        | "interviewing"
        | "offer"
        | "hired"
        | "rejected"
        | "archived"
      auto_apply_status:
        | "pending"
        | "submitted"
        | "handed_off"
        | "dismissed"
        | "expired"
      credit_gate_outcome:
        | "proceeded"
        | "blocked_insufficient_credits"
        | "covered_by_pass"
        | "covered_by_free_allowance"
      credit_reason:
        | "signup_grant"
        | "tailoring_run"
        | "cover_letter_run"
        | "template_unlock"
        | "purchase"
        | "referral_reward_referrer"
        | "referral_reward_referred"
        | "admin_adjustment"
        | "referral_signup_bonus"
        | "referral_activation_bonus"
        | "bullet_rewrite"
        | "scholarship_eligibility_check"
        | "scholarship_sop_draft"
        | "auto_apply_run"
        | "pricing_rebase_4x"
        | "farah_chat_message"
      employment_type: "full_time" | "part_time" | "contract" | "internship"
      farah_message_role: "user" | "farah"
      feedback_category: "bug" | "idea" | "other"
      feedback_status: "new" | "in_review" | "resolved" | "declined"
      job_report_reason:
        | "scam"
        | "closed_but_listed"
        | "discriminatory"
        | "other"
      job_source_type: "internal" | "external"
      job_status: "open" | "closed" | "removed"
      market_segment: "home" | "diaspora"
      org_member_role: "owner" | "admin"
      pass_auto_renew_status: "active" | "canceled" | "lapsed"
      pass_payment_method: "card" | "mobile_money"
      payment_product_type:
        | "credit_pack"
        | "pass"
        | "ad_wallet_topup"
        | "mentor_session"
      payment_status: "pending" | "success" | "failed"
      referral_status: "invited" | "signed_up" | "activated"
      resume_source: "uploaded" | "builder" | "tailored"
      salary_unit: "hour" | "day" | "week" | "month" | "year"
      scholarship_degree_level:
        | "bsc"
        | "msc"
        | "phd"
        | "postgraduate_diploma"
        | "other"
      scholarship_funding_type: "full" | "partial"
      scholarship_moderation_status: "pending" | "verified" | "rejected"
      scholarship_save_status: "saved" | "applying" | "submitted" | "outcome"
      seniority_level: "entry" | "mid" | "senior" | "lead" | "executive"
      work_type: "remote" | "hybrid" | "onsite"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      ad_campaign_status: [
        "draft",
        "pending_review",
        "rejected",
        "active",
        "paused_by_employer",
        "paused_insufficient_funds",
        "completed",
      ],
      ad_event_type: ["impression", "click", "apply"],
      ad_wallet_reason: [
        "topup",
        "campaign_charge",
        "admin_adjustment",
        "reversal",
      ],
      admin_permission: [
        "scholarships",
        "reported_postings",
        "ad_campaigns",
        "feedback",
        "courses",
        "operations",
        "finance",
        "people",
        "operators",
        "blog",
        "feature_flags",
        "people_list",
        "employer_verification",
        "job_review",
        "mentor_review",
      ],
      applicant_review_status: [
        "new",
        "reviewing",
        "shortlisted",
        "interviewing",
        "hired",
        "not_a_fit",
      ],
      application_source: ["internal_apply", "manual", "auto_apply"],
      application_stage: [
        "saved",
        "applied",
        "interviewing",
        "offer",
        "hired",
        "rejected",
        "archived",
      ],
      auto_apply_status: [
        "pending",
        "submitted",
        "handed_off",
        "dismissed",
        "expired",
      ],
      credit_gate_outcome: [
        "proceeded",
        "blocked_insufficient_credits",
        "covered_by_pass",
        "covered_by_free_allowance",
      ],
      credit_reason: [
        "signup_grant",
        "tailoring_run",
        "cover_letter_run",
        "template_unlock",
        "purchase",
        "referral_reward_referrer",
        "referral_reward_referred",
        "admin_adjustment",
        "referral_signup_bonus",
        "referral_activation_bonus",
        "bullet_rewrite",
        "scholarship_eligibility_check",
        "scholarship_sop_draft",
        "auto_apply_run",
        "pricing_rebase_4x",
        "farah_chat_message",
      ],
      employment_type: ["full_time", "part_time", "contract", "internship"],
      farah_message_role: ["user", "farah"],
      feedback_category: ["bug", "idea", "other"],
      feedback_status: ["new", "in_review", "resolved", "declined"],
      job_report_reason: [
        "scam",
        "closed_but_listed",
        "discriminatory",
        "other",
      ],
      job_source_type: ["internal", "external"],
      job_status: ["open", "closed", "removed"],
      market_segment: ["home", "diaspora"],
      org_member_role: ["owner", "admin"],
      pass_auto_renew_status: ["active", "canceled", "lapsed"],
      pass_payment_method: ["card", "mobile_money"],
      payment_product_type: [
        "credit_pack",
        "pass",
        "ad_wallet_topup",
        "mentor_session",
      ],
      payment_status: ["pending", "success", "failed"],
      referral_status: ["invited", "signed_up", "activated"],
      resume_source: ["uploaded", "builder", "tailored"],
      salary_unit: ["hour", "day", "week", "month", "year"],
      scholarship_degree_level: [
        "bsc",
        "msc",
        "phd",
        "postgraduate_diploma",
        "other",
      ],
      scholarship_funding_type: ["full", "partial"],
      scholarship_moderation_status: ["pending", "verified", "rejected"],
      scholarship_save_status: ["saved", "applying", "submitted", "outcome"],
      seniority_level: ["entry", "mid", "senior", "lead", "executive"],
      work_type: ["remote", "hybrid", "onsite"],
    },
  },
} as const
