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
        Relationships: []
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
        Relationships: []
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
          created_at: string
          id: string
          job_posting_id: string | null
          manual_job_snapshot: Json | null
          notes: string | null
          resume_id: string | null
          source: Database["public"]["Enums"]["application_source"]
          stage: Database["public"]["Enums"]["application_stage"]
          updated_at: string
          user_id: string
        }
        Insert: {
          applied_at?: string | null
          cover_letter_id?: string | null
          created_at?: string
          id?: string
          job_posting_id?: string | null
          manual_job_snapshot?: Json | null
          notes?: string | null
          resume_id?: string | null
          source?: Database["public"]["Enums"]["application_source"]
          stage?: Database["public"]["Enums"]["application_stage"]
          updated_at?: string
          user_id: string
        }
        Update: {
          applied_at?: string | null
          cover_letter_id?: string | null
          created_at?: string
          id?: string
          job_posting_id?: string | null
          manual_job_snapshot?: Json | null
          notes?: string | null
          resume_id?: string | null
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
      email_preferences: {
        Row: {
          created_at: string
          digest_last_sent_at: string | null
          job_match_digest: boolean
          unsubscribe_token: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          digest_last_sent_at?: string | null
          job_match_digest?: boolean
          unsubscribe_token?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          digest_last_sent_at?: string | null
          job_match_digest?: boolean
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
        Relationships: []
      }
      job_postings: {
        Row: {
          company_logo_url: string | null
          company_name: string
          created_at: string
          dedup_fingerprint: string
          description: string
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
          seniority: Database["public"]["Enums"]["seniority_level"] | null
          source_type: Database["public"]["Enums"]["job_source_type"]
          status: Database["public"]["Enums"]["job_status"]
          structured_jd: Json
          title: string
          work_type: Database["public"]["Enums"]["work_type"] | null
          years_experience_min: number | null
        }
        Insert: {
          company_logo_url?: string | null
          company_name: string
          created_at?: string
          dedup_fingerprint: string
          description: string
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
          seniority?: Database["public"]["Enums"]["seniority_level"] | null
          source_type: Database["public"]["Enums"]["job_source_type"]
          status?: Database["public"]["Enums"]["job_status"]
          structured_jd?: Json
          title: string
          work_type?: Database["public"]["Enums"]["work_type"] | null
          years_experience_min?: number | null
        }
        Update: {
          company_logo_url?: string | null
          company_name?: string
          created_at?: string
          dedup_fingerprint?: string
          description?: string
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
          seniority?: Database["public"]["Enums"]["seniority_level"] | null
          source_type?: Database["public"]["Enums"]["job_source_type"]
          status?: Database["public"]["Enums"]["job_status"]
          structured_jd?: Json
          title?: string
          work_type?: Database["public"]["Enums"]["work_type"] | null
          years_experience_min?: number | null
        }
        Relationships: [
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
          created_at: string
          created_by: string
          description: string | null
          domain: string | null
          id: string
          logo_url: string | null
          name: string
          updated_at: string
          verified: boolean
        }
        Insert: {
          created_at?: string
          created_by: string
          description?: string | null
          domain?: string | null
          id?: string
          logo_url?: string | null
          name: string
          updated_at?: string
          verified?: boolean
        }
        Update: {
          created_at?: string
          created_by?: string
          description?: string | null
          domain?: string | null
          id?: string
          logo_url?: string | null
          name?: string
          updated_at?: string
          verified?: boolean
        }
        Relationships: [
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
      profiles: {
        Row: {
          country: string | null
          created_at: string
          credits_balance: number
          email: string
          farah_hint_dismissed_at: string | null
          resume_skills_notice_dismissed_at: string | null
          first_name: string | null
          free_trial_cover_letter_used: boolean
          free_trial_tailoring_used: boolean
          id: string
          last_name: string | null
          locale: string
          market_segment: Database["public"]["Enums"]["market_segment"]
          referral_code: string
          referred_by: string | null
          updated_at: string
        }
        Insert: {
          country?: string | null
          created_at?: string
          credits_balance?: number
          email: string
          farah_hint_dismissed_at?: string | null
          resume_skills_notice_dismissed_at?: string | null
          first_name?: string | null
          free_trial_cover_letter_used?: boolean
          free_trial_tailoring_used?: boolean
          id: string
          last_name?: string | null
          locale?: string
          market_segment?: Database["public"]["Enums"]["market_segment"]
          referral_code: string
          referred_by?: string | null
          updated_at?: string
        }
        Update: {
          country?: string | null
          created_at?: string
          credits_balance?: number
          email?: string
          farah_hint_dismissed_at?: string | null
          resume_skills_notice_dismissed_at?: string | null
          first_name?: string | null
          free_trial_cover_letter_used?: boolean
          free_trial_tailoring_used?: boolean
          id?: string
          last_name?: string | null
          locale?: string
          market_segment?: Database["public"]["Enums"]["market_segment"]
          referral_code?: string
          referred_by?: string | null
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
          user_id: string
        }
        Insert: {
          channel: string
          created_at?: string
          id?: string
          user_id: string
        }
        Update: {
          channel?: string
          created_at?: string
          id?: string
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
      resume_templates: {
        Row: {
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
      admin_moderate_job_posting: {
        Args: { p_action: string; p_actor: string; p_id: string; p_reason: string }
        Returns: { new_status: string; ok: boolean; reason: string }[]
      }
      admin_moderate_scholarship: {
        Args: { p_actor: string; p_id: string; p_note: string; p_status: string }
        Returns: { ok: boolean; reason: string }[]
      }
      admin_permission_catalog: {
        Args: Record<PropertyKey, never>
        Returns: { permission: Database["public"]["Enums"]["admin_permission"] }[]
      }
      admin_triage_feedback: {
        Args: { p_actor: string; p_id: string; p_note: string; p_status: string }
        Returns: { ok: boolean; reason: string }[]
      }
      admin_update_course: {
        Args: {
          p_actor: string
          p_active?: boolean
          p_affiliate_url?: string
          p_id: string
          p_price_tier?: string
          p_provider?: string
          p_skill_tag?: string
          p_title?: string
        }
        Returns: { ok: boolean; reason: string }[]
      }
      admin_create_operator: {
        Args: {
          p_actor: string
          p_display_name: string
          p_email: string
          p_role_id: string
          p_user_id: string
        }
        Returns: { ok: boolean; reason: string }[]
      }
      admin_delete_role: {
        Args: { p_actor: string; p_role_id: string }
        Returns: { ok: boolean; reason: string }[]
      }
      admin_has_permission: {
        Args: { p_admin: string; p_permission: Database["public"]["Enums"]["admin_permission"] }
        Returns: boolean
      }
      admin_operators_covered: {
        Args: Record<PropertyKey, never>
        Returns: boolean
      }
      admin_set_feature_flag: {
        Args: { p_actor: string; p_enabled: boolean; p_key: string }
        Returns: { ok: boolean; reason: string }[]
      }
      admin_set_operator: {
        Args: {
          p_actor: string
          p_disabled?: boolean
          p_role_id?: string
          p_target: string
        }
        Returns: { ok: boolean; reason: string }[]
      }
      admin_upsert_role: {
        Args: {
          p_actor: string
          p_name: string
          p_permissions: Database["public"]["Enums"]["admin_permission"][]
          p_role_id: string
        }
        Returns: { ok: boolean; reason: string; role_id: string }[]
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
      auto_apply_claim_submission: {
        Args: {
          p_credit_cost: number
          p_daily_cap: number
          p_free_per_week: number
          p_min_score: number
          p_queue_id: string
          p_user_id: string
        }
        Returns: {
          charge: number
          job_posting_id: string
          ok: boolean
          reason: string
          source_type: Database["public"]["Enums"]["job_source_type"]
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
      claim_anonymous_demo_run: {
        Args: { p_daily_cap: number; p_ip_hash: string; p_visitor_id: string }
        Returns: {
          allowed: boolean
          reason: string
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
      generate_referral_code: { Args: never; Returns: string }
      email_unsubscribe: {
        Args: { p_subscribed?: boolean; p_token: string }
        Returns: {
          job_match_digest: boolean
          matched: boolean
        }[]
      }
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
      normalize_email_for_self_referral: {
        Args: { p_email: string }
        Returns: string
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
      promoted_jobs: {
        Args: {
          p_limit?: number
          p_min_score?: number
          p_seniority?: Database["public"]["Enums"]["seniority_level"]
          p_work_type?: Database["public"]["Enums"]["work_type"]
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
      set_ad_campaign_review: {
        Args: {
          p_approve: boolean
          p_campaign_id: string
          p_note?: string
          p_reviewer_id: string
        }
        Returns: Database["public"]["Enums"]["ad_campaign_status"]
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
      submit_ad_campaign_for_review: {
        Args: { p_actor_user_id: string; p_campaign_id: string }
        Returns: Database["public"]["Enums"]["ad_campaign_status"]
      }
    }
    Enums: {
      admin_permission:
        | "blog"
        | "feature_flags"
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
      credit_gate_outcome: "proceeded" | "blocked_insufficient_credits"
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
      payment_product_type: "credit_pack" | "pass" | "ad_wallet_topup"
      payment_status: "pending" | "success" | "failed"
      referral_status: "invited" | "signed_up" | "activated"
      resume_source: "uploaded" | "builder" | "tailored"
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
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
      credit_gate_outcome: ["proceeded", "blocked_insufficient_credits"],
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
      payment_product_type: ["credit_pack", "pass", "ad_wallet_topup"],
      payment_status: ["pending", "success", "failed"],
      referral_status: ["invited", "signed_up", "activated"],
      resume_source: ["uploaded", "builder", "tailored"],
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
