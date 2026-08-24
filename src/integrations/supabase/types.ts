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
      action_emails: {
        Row: {
          action_item_id: string | null
          client_id: string
          created_at: string
          email_type: string
          id: string
          recipient_email: string
          sent_at: string | null
          status: string
        }
        Insert: {
          action_item_id?: string | null
          client_id: string
          created_at?: string
          email_type: string
          id?: string
          recipient_email: string
          sent_at?: string | null
          status?: string
        }
        Update: {
          action_item_id?: string | null
          client_id?: string
          created_at?: string
          email_type?: string
          id?: string
          recipient_email?: string
          sent_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "action_emails_action_item_id_fkey"
            columns: ["action_item_id"]
            isOneToOne: false
            referencedRelation: "action_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "action_emails_action_item_id_fkey"
            columns: ["action_item_id"]
            isOneToOne: false
            referencedRelation: "action_items_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "action_emails_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      action_items: {
        Row: {
          blocker_note: string | null
          client_id: string
          completed_at: string | null
          created_at: string
          driver_key: string | null
          due_date: string | null
          id: string
          outcome_why: string | null
          owner_id: string | null
          plan_id: string
          progress_pct: number
          sent_at: string | null
          seq: number
          source: Database["public"]["Enums"]["action_source"]
          source_move_key: string | null
          status: Database["public"]["Enums"]["action_status"]
          title: string
          updated_at: string
        }
        Insert: {
          blocker_note?: string | null
          client_id: string
          completed_at?: string | null
          created_at?: string
          driver_key?: string | null
          due_date?: string | null
          id?: string
          outcome_why?: string | null
          owner_id?: string | null
          plan_id: string
          progress_pct?: number
          sent_at?: string | null
          seq: number
          source?: Database["public"]["Enums"]["action_source"]
          source_move_key?: string | null
          status?: Database["public"]["Enums"]["action_status"]
          title: string
          updated_at?: string
        }
        Update: {
          blocker_note?: string | null
          client_id?: string
          completed_at?: string | null
          created_at?: string
          driver_key?: string | null
          due_date?: string | null
          id?: string
          outcome_why?: string | null
          owner_id?: string | null
          plan_id?: string
          progress_pct?: number
          sent_at?: string | null
          seq?: number
          source?: Database["public"]["Enums"]["action_source"]
          source_move_key?: string | null
          status?: Database["public"]["Enums"]["action_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "action_items_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "action_items_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "client_employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "action_items_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "action_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      action_milestones: {
        Row: {
          action_item_id: string
          done_at: string | null
          id: string
          is_done: boolean
          label: string
          week_no: number
        }
        Insert: {
          action_item_id: string
          done_at?: string | null
          id?: string
          is_done?: boolean
          label: string
          week_no: number
        }
        Update: {
          action_item_id?: string
          done_at?: string | null
          id?: string
          is_done?: boolean
          label?: string
          week_no?: number
        }
        Relationships: [
          {
            foreignKeyName: "action_milestones_action_item_id_fkey"
            columns: ["action_item_id"]
            isOneToOne: false
            referencedRelation: "action_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "action_milestones_action_item_id_fkey"
            columns: ["action_item_id"]
            isOneToOne: false
            referencedRelation: "action_items_v"
            referencedColumns: ["id"]
          },
        ]
      }
      action_plans: {
        Row: {
          client_id: string
          created_at: string
          id: string
          is_active: boolean
          metric_current: number | null
          metric_name: string | null
          metric_start: number | null
          metric_target: number | null
          outcome_goal: string
          period_label: string
          target_date: string
          why_statement: string | null
        }
        Insert: {
          client_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          metric_current?: number | null
          metric_name?: string | null
          metric_start?: number | null
          metric_target?: number | null
          outcome_goal: string
          period_label: string
          target_date: string
          why_statement?: string | null
        }
        Update: {
          client_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          metric_current?: number | null
          metric_name?: string | null
          metric_start?: number | null
          metric_target?: number | null
          outcome_goal?: string
          period_label?: string
          target_date?: string
          why_statement?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "action_plans_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      action_tokens: {
        Row: {
          action_item_id: string
          created_at: string
          employee_id: string
          expires_at: string
          id: string
          last_used_at: string | null
          revoked_at: string | null
          token_hash: string
          use_count: number
        }
        Insert: {
          action_item_id: string
          created_at?: string
          employee_id: string
          expires_at: string
          id?: string
          last_used_at?: string | null
          revoked_at?: string | null
          token_hash: string
          use_count?: number
        }
        Update: {
          action_item_id?: string
          created_at?: string
          employee_id?: string
          expires_at?: string
          id?: string
          last_used_at?: string | null
          revoked_at?: string | null
          token_hash?: string
          use_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "action_tokens_action_item_id_fkey"
            columns: ["action_item_id"]
            isOneToOne: false
            referencedRelation: "action_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "action_tokens_action_item_id_fkey"
            columns: ["action_item_id"]
            isOneToOne: false
            referencedRelation: "action_items_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "action_tokens_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "client_employees"
            referencedColumns: ["id"]
          },
        ]
      }
      action_updates: {
        Row: {
          action_item_id: string
          actor_label: string
          actor_type: string
          client_id: string
          created_at: string
          id: string
          note: string | null
          progress_from: number | null
          progress_to: number | null
          status_from: Database["public"]["Enums"]["action_status"] | null
          status_to: Database["public"]["Enums"]["action_status"] | null
        }
        Insert: {
          action_item_id: string
          actor_label: string
          actor_type: string
          client_id: string
          created_at?: string
          id?: string
          note?: string | null
          progress_from?: number | null
          progress_to?: number | null
          status_from?: Database["public"]["Enums"]["action_status"] | null
          status_to?: Database["public"]["Enums"]["action_status"] | null
        }
        Update: {
          action_item_id?: string
          actor_label?: string
          actor_type?: string
          client_id?: string
          created_at?: string
          id?: string
          note?: string | null
          progress_from?: number | null
          progress_to?: number | null
          status_from?: Database["public"]["Enums"]["action_status"] | null
          status_to?: Database["public"]["Enums"]["action_status"] | null
        }
        Relationships: [
          {
            foreignKeyName: "action_updates_action_item_id_fkey"
            columns: ["action_item_id"]
            isOneToOne: false
            referencedRelation: "action_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "action_updates_action_item_id_fkey"
            columns: ["action_item_id"]
            isOneToOne: false
            referencedRelation: "action_items_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "action_updates_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      ask_ai_cache: {
        Row: {
          answer: string
          created_at: string
          hit_count: number
          id: string
          question_hash: string
        }
        Insert: {
          answer: string
          created_at?: string
          hit_count?: number
          id?: string
          question_hash: string
        }
        Update: {
          answer?: string
          created_at?: string
          hit_count?: number
          id?: string
          question_hash?: string
        }
        Relationships: []
      }
      ask_ai_log: {
        Row: {
          client_id: string
          created_at: string
          id: string
          input_tokens: number
          latency_ms: number
          output_tokens: number
          tier: string
          user_id: string
        }
        Insert: {
          client_id: string
          created_at?: string
          id?: string
          input_tokens?: number
          latency_ms?: number
          output_tokens?: number
          tier: string
          user_id: string
        }
        Update: {
          client_id?: string
          created_at?: string
          id?: string
          input_tokens?: number
          latency_ms?: number
          output_tokens?: number
          tier?: string
          user_id?: string
        }
        Relationships: []
      }
      advisory_deliveries: {
        Row: {
          id: string
          client_id: string
          firm_id: string | null
          channel: string
          kind: string
          subject: string | null
          body: string | null
          recipient_email: string | null
          recipient_name: string | null
          report_key: string | null
          snapshot_id: string | null
          figures_hash: string | null
          period_label: string | null
          created_by: string
          created_at: string
          acknowledged_at: string | null
          acknowledged_by: string | null
          ack_token: string | null
          pdf_storage_path: string | null
          pdf_byte_size: number | null
        }
        Insert: {
          id?: string
          client_id: string
          firm_id?: string | null
          channel: string
          kind: string
          subject?: string | null
          body?: string | null
          recipient_email?: string | null
          recipient_name?: string | null
          report_key?: string | null
          snapshot_id?: string | null
          figures_hash?: string | null
          period_label?: string | null
          created_by: string
          created_at?: string
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          ack_token?: string | null
          pdf_storage_path?: string | null
          pdf_byte_size?: number | null
        }
        Update: {
          id?: string
          client_id?: string
          firm_id?: string | null
          channel?: string
          kind?: string
          subject?: string | null
          body?: string | null
          recipient_email?: string | null
          recipient_name?: string | null
          report_key?: string | null
          snapshot_id?: string | null
          figures_hash?: string | null
          period_label?: string | null
          created_by?: string
          created_at?: string
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          ack_token?: string | null
          pdf_storage_path?: string | null
          pdf_byte_size?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "advisory_deliveries_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      client_employees: {
        Row: {
          active: boolean
          client_id: string
          created_at: string
          email: string | null
          id: string
          name: string
          role: string | null
          weekly_hours: number | null
        }
        Insert: {
          active?: boolean
          client_id: string
          created_at?: string
          email?: string | null
          id?: string
          name: string
          role?: string | null
          weekly_hours?: number | null
        }
        Update: {
          active?: boolean
          client_id?: string
          created_at?: string
          email?: string | null
          id?: string
          name?: string
          role?: string | null
          weekly_hours?: number | null
        }
        Relationships: []
      }
      client_financial_snapshots: {
        Row: {
          client_id: string
          created_at: string
          created_by: string | null
          financials: Json
          id: string
          period_date: string
          period_label: string
          ratios: Json
          source: string
        }
        Insert: {
          client_id: string
          created_at?: string
          created_by?: string | null
          financials?: Json
          id?: string
          period_date: string
          period_label: string
          ratios?: Json
          source?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          created_by?: string | null
          financials?: Json
          id?: string
          period_date?: string
          period_label?: string
          ratios?: Json
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_financial_snapshots_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      client_memberships: {
        Row: {
          client_id: string
          created_at: string
          id: string
          role: string
          user_id: string
        }
        Insert: {
          client_id: string
          created_at?: string
          id?: string
          role?: string
          user_id: string
        }
        Update: {
          client_id?: string
          created_at?: string
          id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_memberships_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      client_notes: {
        Row: {
          id: string
          client_id: string
          tab: string
          x: number
          y: number
          body: string
          author_id: string
          author_name: string
          author_email: string | null
          resolved: boolean
          mentions: Json
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          client_id: string
          tab?: string
          x?: number
          y?: number
          body: string
          author_id: string
          author_name: string
          author_email?: string | null
          resolved?: boolean
          mentions?: Json
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          client_id?: string
          tab?: string
          x?: number
          y?: number
          body?: string
          author_id?: string
          author_name?: string
          author_email?: string | null
          resolved?: boolean
          mentions?: Json
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_notes_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      client_note_replies: {
        Row: {
          id: string
          note_id: string
          client_id: string
          body: string
          author_id: string
          author_name: string
          author_email: string | null
          mentions: Json
          created_at: string
        }
        Insert: {
          id?: string
          note_id: string
          client_id: string
          body: string
          author_id: string
          author_name: string
          author_email?: string | null
          mentions?: Json
          created_at?: string
        }
        Update: {
          id?: string
          note_id?: string
          client_id?: string
          body?: string
          author_id?: string
          author_name?: string
          author_email?: string | null
          mentions?: Json
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_note_replies_note_id_fkey"
            columns: ["note_id"]
            isOneToOne: false
            referencedRelation: "client_notes"
            referencedColumns: ["id"]
          },
        ]
      }
      client_review_signoffs: {
        Row: {
          id: string
          client_id: string
          scope: string
          signed_off_by_id: string
          signed_off_by_name: string
          signed_off_by_initials: string | null
          signed_off_by_title: string | null
          firm_name: string | null
          note: string | null
          signed_off_at: string
          created_at: string
        }
        Insert: {
          id?: string
          client_id: string
          scope: string
          signed_off_by_id?: string
          signed_off_by_name: string
          signed_off_by_initials?: string | null
          signed_off_by_title?: string | null
          firm_name?: string | null
          note?: string | null
          signed_off_at?: string
          created_at?: string
        }
        Update: {
          id?: string
          client_id?: string
          scope?: string
          signed_off_by_id?: string
          signed_off_by_name?: string
          signed_off_by_initials?: string | null
          signed_off_by_title?: string | null
          firm_name?: string | null
          note?: string | null
          signed_off_at?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_review_signoffs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      client_review_signoff_history: {
        Row: {
          id: string
          client_id: string
          scope: string
          signed_off_by_id: string
          signed_off_by_name: string
          signed_off_by_initials: string | null
          signed_off_by_title: string | null
          firm_name: string | null
          note: string | null
          signed_off_at: string
          action: string
          created_at: string
        }
        Insert: {
          id?: string
          client_id: string
          scope: string
          signed_off_by_id: string
          signed_off_by_name: string
          signed_off_by_initials?: string | null
          signed_off_by_title?: string | null
          firm_name?: string | null
          note?: string | null
          signed_off_at?: string
          action?: string
          created_at?: string
        }
        Update: {
          id?: string
          client_id?: string
          scope?: string
          signed_off_by_id?: string
          signed_off_by_name?: string
          signed_off_by_initials?: string | null
          signed_off_by_title?: string | null
          firm_name?: string | null
          note?: string | null
          signed_off_at?: string
          action?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_review_signoff_history_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      client_score_history: {
        Row: {
          client_id: string
          created_at: string
          id: string
          is_estimated: boolean
          period_date: string
          score: number
        }
        Insert: {
          client_id: string
          created_at?: string
          id?: string
          is_estimated?: boolean
          period_date: string
          score: number
        }
        Update: {
          client_id?: string
          created_at?: string
          id?: string
          is_estimated?: boolean
          period_date?: string
          score?: number
        }
        Relationships: [
          {
            foreignKeyName: "client_score_history_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          business_type: string | null
          cash_runway_weeks: number | null
          cashflow: Json | null
          cashflow_bank_draft: Json | null
          budget: Json | null
          budget_updated_at: string | null
          operating_profile: Json | null
          financial_year_start_month: number | null
          contact_email: string | null
          contact_phone: string | null
          created_at: string
          financials: Json | null
          firm_id: string | null
          id: string
          last_forecast_at: string | null
          last_login_at: string | null
          name: string
          client_code: string | null
          open_queries_count: number
          owner_user_id: string
          reports_issued_count: number
        }
        Insert: {
          business_type?: string | null
          cash_runway_weeks?: number | null
          cashflow?: Json | null
          cashflow_bank_draft?: Json | null
          budget?: Json | null
          budget_updated_at?: string | null
          operating_profile?: Json | null
          financial_year_start_month?: number | null
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          financials?: Json | null
          firm_id?: string | null
          id?: string
          last_forecast_at?: string | null
          last_login_at?: string | null
          name: string
          client_code?: string | null
          open_queries_count?: number
          owner_user_id: string
          reports_issued_count?: number
        }
        Update: {
          business_type?: string | null
          cash_runway_weeks?: number | null
          cashflow?: Json | null
          cashflow_bank_draft?: Json | null
          budget?: Json | null
          budget_updated_at?: string | null
          operating_profile?: Json | null
          financial_year_start_month?: number | null
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          financials?: Json | null
          firm_id?: string | null
          id?: string
          last_forecast_at?: string | null
          last_login_at?: string | null
          name?: string
          client_code?: string | null
          open_queries_count?: number
          owner_user_id?: string
          reports_issued_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "clients_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_tasks: {
        Row: {
          client_id: string
          completed_at: string | null
          created_at: string
          created_by: string | null
          description: string | null
          due_date: string | null
          employee_id: string
          id: string
          source: Database["public"]["Enums"]["employee_task_source"]
          source_ref: string | null
          status: Database["public"]["Enums"]["employee_task_status"]
          title: string
        }
        Insert: {
          client_id: string
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_date?: string | null
          employee_id: string
          id?: string
          source?: Database["public"]["Enums"]["employee_task_source"]
          source_ref?: string | null
          status?: Database["public"]["Enums"]["employee_task_status"]
          title: string
        }
        Update: {
          client_id?: string
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_date?: string | null
          employee_id?: string
          id?: string
          source?: Database["public"]["Enums"]["employee_task_source"]
          source_ref?: string | null
          status?: Database["public"]["Enums"]["employee_task_status"]
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "employee_tasks_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "client_employees"
            referencedColumns: ["id"]
          },
        ]
      }
      firm_memberships: {
        Row: {
          created_at: string
          firm_id: string
          id: string
          role: string
          user_id: string
        }
        Insert: {
          created_at?: string
          firm_id: string
          id?: string
          role?: string
          user_id: string
        }
        Update: {
          created_at?: string
          firm_id?: string
          id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "firm_memberships_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
        ]
      }
      firms: {
        Row: {
          created_at: string
          id: string
          name: string
          owner_user_id: string
          referral_code: string | null
          logo_url: string | null
          accent_color: string | null
          primary_color: string | null
          secondary_color: string | null
          tagline: string | null
          brand_contact_name: string | null
          brand_contact_email: string | null
          brand_updated_at: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          owner_user_id: string
          referral_code?: string | null
          logo_url?: string | null
          accent_color?: string | null
          primary_color?: string | null
          secondary_color?: string | null
          tagline?: string | null
          brand_contact_name?: string | null
          brand_contact_email?: string | null
          brand_updated_at?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          owner_user_id?: string
          referral_code?: string | null
          logo_url?: string | null
          accent_color?: string | null
          primary_color?: string | null
          secondary_color?: string | null
          tagline?: string | null
          brand_contact_name?: string | null
          brand_contact_email?: string | null
          brand_updated_at?: string | null
        }
        Relationships: []
      }
      invite_tokens: {
        Row: {
          id: string
          token: string
          client_id: string
          created_by: string
          purpose: string
          expires_at: string
          redeemed_at: string | null
          redeemed_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          token: string
          client_id: string
          created_by: string
          purpose?: string
          expires_at?: string
          redeemed_at?: string | null
          redeemed_by?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          token?: string
          client_id?: string
          created_by?: string
          purpose?: string
          expires_at?: string
          redeemed_at?: string | null
          redeemed_by?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "invite_tokens_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      impersonation_audit: {
        Row: {
          client_id: string
          ended_at: string | null
          firm_id: string | null
          firm_user_id: string
          id: string
          started_at: string
        }
        Insert: {
          client_id: string
          ended_at?: string | null
          firm_id?: string | null
          firm_user_id: string
          id?: string
          started_at?: string
        }
        Update: {
          client_id?: string
          ended_at?: string | null
          firm_id?: string | null
          firm_user_id?: string
          id?: string
          started_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "impersonation_audit_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "impersonation_audit_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
        ]
      }
      industry_benchmarks: {
        Row: {
          business_type: string
          created_at: string
          higher_is_better: boolean
          id: string
          metric_key: string
          p25: number
          p50: number
          p75: number
          unit: string
        }
        Insert: {
          business_type: string
          created_at?: string
          higher_is_better?: boolean
          id?: string
          metric_key: string
          p25: number
          p50: number
          p75: number
          unit?: string
        }
        Update: {
          business_type?: string
          created_at?: string
          higher_is_better?: boolean
          id?: string
          metric_key?: string
          p25?: number
          p50?: number
          p75?: number
          unit?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      qbo_connections: {
        Row: {
          access_token: string
          client_id: string
          company_name: string | null
          connected_at: string | null
          id: string
          last_synced_at: string | null
          realm_id: string
          refresh_token: string
          sync_error: string | null
          sync_status: string | null
          token_expiry: string
        }
        Insert: {
          access_token: string
          client_id: string
          company_name?: string | null
          connected_at?: string | null
          id?: string
          last_synced_at?: string | null
          realm_id: string
          refresh_token: string
          sync_error?: string | null
          sync_status?: string | null
          token_expiry: string
        }
        Update: {
          access_token?: string
          client_id?: string
          company_name?: string | null
          connected_at?: string | null
          id?: string
          last_synced_at?: string | null
          realm_id?: string
          refresh_token?: string
          sync_error?: string | null
          sync_status?: string | null
          token_expiry?: string
        }
        Relationships: [
          {
            foreignKeyName: "qbo_connections_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: true
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      qbo_oauth_states: {
        Row: {
          client_id: string
          created_at: string | null
          id: string
          state: string
        }
        Insert: {
          client_id: string
          created_at?: string | null
          id?: string
          state: string
        }
        Update: {
          client_id?: string
          created_at?: string | null
          id?: string
          state?: string
        }
        Relationships: [
          {
            foreignKeyName: "qbo_oauth_states_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      qbo_sync_data: {
        Row: {
          client_id: string
          data_type: string
          id: string
          raw_data: Json | null
          synced_at: string | null
        }
        Insert: {
          client_id: string
          data_type: string
          id?: string
          raw_data?: Json | null
          synced_at?: string | null
        }
        Update: {
          client_id?: string
          data_type?: string
          id?: string
          raw_data?: Json | null
          synced_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "qbo_sync_data_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      action_items_v: {
        Row: {
          blocker_note: string | null
          client_id: string | null
          completed_at: string | null
          created_at: string | null
          days_remaining: number | null
          driver_key: string | null
          due_date: string | null
          health: Database["public"]["Enums"]["action_health"] | null
          id: string | null
          outcome_why: string | null
          owner_email: string | null
          owner_id: string | null
          owner_name: string | null
          owner_role: string | null
          plan_id: string | null
          progress_pct: number | null
          sent_at: string | null
          seq: number | null
          source: Database["public"]["Enums"]["action_source"] | null
          source_move_key: string | null
          status: Database["public"]["Enums"]["action_status"] | null
          title: string | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "action_items_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "action_items_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "client_employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "action_items_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "action_plans"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      action_item_health: {
        Args: {
          p_created: string
          p_due: string
          p_progress: number
          p_status: Database["public"]["Enums"]["action_status"]
        }
        Returns: Database["public"]["Enums"]["action_health"]
      }
      ask_ai_check_rate_limit: {
        Args: { p_limit?: number; p_user_id: string }
        Returns: boolean
      }
      ask_ai_record_request: {
        Args: {
          p_client_id: string
          p_input_tokens?: number
          p_latency_ms?: number
          p_limit?: number
          p_output_tokens?: number
          p_tier: string
          p_user_id: string
        }
        Returns: boolean
      }
      ensure_own_client: {
        Args: { p_name: string }
        Returns: string
      }
      mint_owner_invite: {
        Args: { p_client_id: string }
        Returns: string
      }
          create_firm_client: {
            Args: {
              p_name: string
              p_firm_id?: string | null
              p_business_type?: string | null
            }
            Returns: Json
          }
          ensure_practice_firm: {
            Args: { p_name?: string | null }
            Returns: string
          }
      has_client_access: {
        Args: { _client_id: string; _user_id: string }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_client_writer: {
        Args: { _user_id: string; _client_id: string }
        Returns: boolean
      }
      is_firm_member: {
        Args: { _firm_id: string; _user_id: string }
        Returns: boolean
      }
      acknowledge_advisory_delivery: {
        Args: { _token: string }
        Returns: Database["public"]["Tables"]["advisory_deliveries"]["Row"]
      }
    }
    Enums: {
      action_health:
        | "on_track"
        | "at_risk"
        | "off_track"
        | "overdue"
        | "complete"
      action_source: "strategic_move" | "manual"
      action_status: "not_started" | "in_progress" | "done" | "blocked"
      app_role: "accountant" | "firm_admin" | "client_owner" | "client_member"
      employee_task_source:
        | "kpi"
        | "improvement"
        | "cashflow_line"
        | "sop_weekly"
        | "manual"
      employee_task_status: "open" | "done" | "skipped"
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
      action_health: [
        "on_track",
        "at_risk",
        "off_track",
        "overdue",
        "complete",
      ],
      action_source: ["strategic_move", "manual"],
      action_status: ["not_started", "in_progress", "done", "blocked"],
      app_role: ["accountant", "firm_admin", "client_owner", "client_member"],
      employee_task_source: [
        "kpi",
        "improvement",
        "cashflow_line",
        "sop_weekly",
        "manual",
      ],
      employee_task_status: ["open", "done", "skipped"],
    },
  },
} as const
