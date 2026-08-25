// Generated via the Supabase MCP `generate_typescript_types` tool against the
// "Talentrah" project (nytwbbzfpytctjsoczzq). Regenerate after every schema
// migration — do not hand-edit.
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
    PostgrestVersion: "14.17"
  }
  public: {
    Tables: {
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
      job_postings: {
        Row: {
          company_logo_url: string | null
          company_name: string
          created_at: string
          dedup_fingerprint: string
          description: string
          employment_type: Database["public"]["Enums"]["employment_type"] | null
          external_source: string | null
          external_url: string | null
          id: string
          last_checked_at: string
          location: string | null
          organization_id: string | null
          posted_at: string
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
          external_source?: string | null
          external_url?: string | null
          id?: string
          last_checked_at?: string
          location?: string | null
          organization_id?: string | null
          posted_at?: string
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
          external_source?: string | null
          external_url?: string | null
          id?: string
          last_checked_at?: string
          location?: string | null
          organization_id?: string | null
          posted_at?: string
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
          product_id: string
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
          product_id: string
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
          product_id?: string
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
          moderation_note?: string | null
          moderation_status?: Database["public"]["Enums"]["scholarship_moderation_status"]
          official_url?: string
          program_name?: string
          provider?: string
          source_name?: string | null
          updated_at?: string
        }
        Relationships: []
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
          next_renewal_date: string | null
          pass_id: string
          payment_method: Database["public"]["Enums"]["pass_payment_method"]
          payment_transaction_id: string | null
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
          next_renewal_date?: string | null
          pass_id: string
          payment_method: Database["public"]["Enums"]["pass_payment_method"]
          payment_transaction_id?: string | null
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
          next_renewal_date?: string | null
          pass_id?: string
          payment_method?: Database["public"]["Enums"]["pass_payment_method"]
          payment_transaction_id?: string | null
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
      check_and_activate_referral: {
        Args: { p_user_id: string }
        Returns: undefined
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
    }
    Enums: {
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
      job_source_type: "internal" | "external"
      job_status: "open" | "closed"
      market_segment: "home" | "diaspora"
      org_member_role: "owner" | "admin"
      pass_auto_renew_status: "active" | "canceled" | "lapsed"
      pass_payment_method: "card" | "mobile_money"
      payment_product_type: "credit_pack" | "pass"
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
      job_source_type: ["internal", "external"],
      job_status: ["open", "closed"],
      market_segment: ["home", "diaspora"],
      org_member_role: ["owner", "admin"],
      pass_auto_renew_status: ["active", "canceled", "lapsed"],
      pass_payment_method: ["card", "mobile_money"],
      payment_product_type: ["credit_pack", "pass"],
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
