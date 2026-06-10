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
      clients: {
        Row: {
          business_type: string | null
          cash_runway_weeks: number | null
          cashflow: Json | null
          contact_email: string | null
          contact_phone: string | null
          created_at: string
          financials: Json | null
          firm_id: string | null
          id: string
          last_forecast_at: string | null
          last_login_at: string | null
          name: string
          open_queries_count: number
          owner_user_id: string
        }
        Insert: {
          business_type?: string | null
          cash_runway_weeks?: number | null
          cashflow?: Json | null
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          financials?: Json | null
          firm_id?: string | null
          id?: string
          last_forecast_at?: string | null
          last_login_at?: string | null
          name: string
          open_queries_count?: number
          owner_user_id: string
        }
        Update: {
          business_type?: string | null
          cash_runway_weeks?: number | null
          cashflow?: Json | null
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          financials?: Json | null
          firm_id?: string | null
          id?: string
          last_forecast_at?: string | null
          last_login_at?: string | null
          name?: string
          open_queries_count?: number
          owner_user_id?: string
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
      email_send_log: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          message_id: string | null
          metadata: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email?: string
          status?: string
          template_name?: string
        }
        Relationships: []
      }
      email_send_state: {
        Row: {
          auth_email_ttl_minutes: number
          batch_size: number
          id: number
          retry_after_until: string | null
          send_delay_ms: number
          transactional_email_ttl_minutes: number
          updated_at: string
        }
        Insert: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Update: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Relationships: []
      }
      email_unsubscribe_tokens: {
        Row: {
          created_at: string
          email: string
          id: string
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          token: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: []
      }
      employee_sop_items: {
        Row: {
          active: boolean
          client_id: string
          created_at: string
          day_of_week: number
          employee_id: string
          frequency: Database["public"]["Enums"]["sop_frequency"]
          id: string
          title: string
        }
        Insert: {
          active?: boolean
          client_id: string
          created_at?: string
          day_of_week?: number
          employee_id: string
          frequency?: Database["public"]["Enums"]["sop_frequency"]
          id?: string
          title: string
        }
        Update: {
          active?: boolean
          client_id?: string
          created_at?: string
          day_of_week?: number
          employee_id?: string
          frequency?: Database["public"]["Enums"]["sop_frequency"]
          id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "employee_sop_items_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "client_employees"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_sop_log: {
        Row: {
          client_id: string
          completed_at: string
          completed_by: string | null
          id: string
          sop_item_id: string
          week_start: string
        }
        Insert: {
          client_id: string
          completed_at?: string
          completed_by?: string | null
          id?: string
          sop_item_id: string
          week_start: string
        }
        Update: {
          client_id?: string
          completed_at?: string
          completed_by?: string | null
          id?: string
          sop_item_id?: string
          week_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "employee_sop_log_sop_item_id_fkey"
            columns: ["sop_item_id"]
            isOneToOne: false
            referencedRelation: "employee_sop_items"
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
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          owner_user_id: string
          referral_code?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          owner_user_id?: string
          referral_code?: string | null
        }
        Relationships: []
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
      suppressed_emails: {
        Row: {
          created_at: string
          email: string
          id: string
          metadata: Json | null
          reason: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          metadata?: Json | null
          reason: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          metadata?: Json | null
          reason?: string
        }
        Relationships: []
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
      [_ in never]: never
    }
    Functions: {
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
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
      is_firm_member: {
        Args: { _firm_id: string; _user_id: string }
        Returns: boolean
      }
      move_to_dlq: {
        Args: {
          dlq_name: string
          message_id: number
          payload: Json
          source_queue: string
        }
        Returns: number
      }
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
      }
    }
    Enums: {
      app_role: "accountant" | "firm_admin" | "client_owner" | "client_member"
      employee_task_source:
        | "kpi"
        | "improvement"
        | "cashflow_line"
        | "sop_weekly"
        | "manual"
      employee_task_status: "open" | "done" | "skipped"
      sop_frequency: "weekly"
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
      app_role: ["accountant", "firm_admin", "client_owner", "client_member"],
      employee_task_source: [
        "kpi",
        "improvement",
        "cashflow_line",
        "sop_weekly",
        "manual",
      ],
      employee_task_status: ["open", "done", "skipped"],
      sop_frequency: ["weekly"],
    },
  },
} as const
