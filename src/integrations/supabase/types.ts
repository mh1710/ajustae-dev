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
      anatel_products: {
        Row: {
          codigo: string
          codigo_anatel: string | null
          company_id: string | null
          created_at: string
          descricao_comercial: string | null
          ean: string | null
          id: string
          imported_at: string
          marca: string | null
          ncm: string | null
          titulo: string | null
          updated_at: string
        }
        Insert: {
          codigo: string
          codigo_anatel?: string | null
          company_id?: string | null
          created_at?: string
          descricao_comercial?: string | null
          ean?: string | null
          id?: string
          imported_at?: string
          marca?: string | null
          ncm?: string | null
          titulo?: string | null
          updated_at?: string
        }
        Update: {
          codigo?: string
          codigo_anatel?: string | null
          company_id?: string | null
          created_at?: string
          descricao_comercial?: string | null
          ean?: string | null
          id?: string
          imported_at?: string
          marca?: string | null
          ncm?: string | null
          titulo?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "anatel_products_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_results: {
        Row: {
          category: string
          company_id: string
          created_at: string
          details: Json | null
          id: string
          message: string | null
          product_id: string
          rule_id: string
          rule_slug: string
          run_id: string
          severity: string
          status: string
        }
        Insert: {
          category: string
          company_id: string
          created_at?: string
          details?: Json | null
          id?: string
          message?: string | null
          product_id: string
          rule_id: string
          rule_slug: string
          run_id: string
          severity: string
          status: string
        }
        Update: {
          category?: string
          company_id?: string
          created_at?: string
          details?: Json | null
          id?: string
          message?: string | null
          product_id?: string
          rule_id?: string
          rule_slug?: string
          run_id?: string
          severity?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_results_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_results_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "bling_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_results_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "validation_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_results_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "audit_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_runs: {
        Row: {
          company_id: string
          created_at: string
          duration_ms: number | null
          errors_count: number
          finished_at: string | null
          id: string
          passed_count: number
          processed_products: number
          product_ids: string[]
          rule_ids: string[]
          started_at: string | null
          status: string
          total_products: number
          updated_at: string
          user_id: string
          warnings_count: number
          only_active: boolean
          worker_pid: number | null
        }
        Insert: {
          company_id: string
          created_at?: string
          duration_ms?: number | null
          errors_count?: number
          finished_at?: string | null
          id?: string
          passed_count?: number
          processed_products?: number
          product_ids?: string[]
          rule_ids?: string[]
          started_at?: string | null
          status?: string
          total_products?: number
          updated_at?: string
          user_id: string
          warnings_count?: number
          only_active?: boolean
          worker_pid?: number | null
        }
        Update: {
          company_id?: string
          created_at?: string
          duration_ms?: number | null
          errors_count?: number
          finished_at?: string | null
          id?: string
          passed_count?: number
          processed_products?: number
          product_ids?: string[]
          rule_ids?: string[]
          started_at?: string | null
          status?: string
          total_products?: number
          updated_at?: string
          user_id?: string
          warnings_count?: number
          only_active?: boolean
          worker_pid?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_runs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_changes: {
        Row: {
          company_id: string
          created_at: string
          id: number
          loja_id: string | null
          loja_nome: string | null
          nome: string | null
          product_id: string | null
          run_id: string
          sku: string | null
          tipo: string
          valor_anterior: string | null
          valor_novo: string | null
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: number
          loja_id?: string | null
          loja_nome?: string | null
          nome?: string | null
          product_id?: string | null
          run_id: string
          sku?: string | null
          tipo: string
          valor_anterior?: string | null
          valor_novo?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: number
          loja_id?: string | null
          loja_nome?: string | null
          nome?: string | null
          product_id?: string | null
          run_id?: string
          sku?: string | null
          tipo?: string
          valor_anterior?: string | null
          valor_novo?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "automation_changes_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_changes_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "automation_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_runs: {
        Row: {
          company_id: string
          created_at: string
          current_step: string | null
          error: string | null
          finished_at: string | null
          id: string
          result: Json
          slug: string
          started_at: string
          status: string
          steps: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          company_id: string
          created_at?: string
          current_step?: string | null
          error?: string | null
          finished_at?: string | null
          id?: string
          result?: Json
          slug: string
          started_at?: string
          status?: string
          steps?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          company_id?: string
          created_at?: string
          current_step?: string | null
          error?: string | null
          finished_at?: string | null
          id?: string
          result?: Json
          slug?: string
          started_at?: string
          status?: string
          steps?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "automation_runs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_schedules: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          day_of_month: number | null
          enabled: boolean
          frequency: string
          hour: number
          id: string
          interval_days: number | null
          last_run_at: string | null
          last_run_id: string | null
          last_status: string | null
          minute: number
          name: string
          next_run_at: string | null
          options: Json
          slug: string
          timezone: string
          updated_at: string
          weekday: number | null
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          day_of_month?: number | null
          enabled?: boolean
          frequency?: string
          hour?: number
          id?: string
          interval_days?: number | null
          last_run_at?: string | null
          last_run_id?: string | null
          last_status?: string | null
          minute?: number
          name?: string
          next_run_at?: string | null
          options?: Json
          slug?: string
          timezone?: string
          updated_at?: string
          weekday?: number | null
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          day_of_month?: number | null
          enabled?: boolean
          frequency?: string
          hour?: number
          id?: string
          interval_days?: number | null
          last_run_at?: string | null
          last_run_id?: string | null
          last_status?: string | null
          minute?: number
          name?: string
          next_run_at?: string | null
          options?: Json
          slug?: string
          timezone?: string
          updated_at?: string
          weekday?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "automation_schedules_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      bling_api_calls: {
        Row: {
          company_id: string
          created_at: string
          duration_ms: number | null
          endpoint: string
          id: number
          integration_id: string | null
          method: string
          ok: boolean | null
          retries: number | null
          source: string | null
          status: number | null
        }
        Insert: {
          company_id: string
          created_at?: string
          duration_ms?: number | null
          endpoint: string
          id?: number
          integration_id?: string | null
          method: string
          ok?: boolean | null
          retries?: number | null
          source?: string | null
          status?: number | null
        }
        Update: {
          company_id?: string
          created_at?: string
          duration_ms?: number | null
          endpoint?: string
          id?: number
          integration_id?: string | null
          method?: string
          ok?: boolean | null
          retries?: number | null
          source?: string | null
          status?: number | null
        }
        Relationships: []
      }
      bling_api_usage_daily: {
        Row: {
          company_id: string
          dia: string
          total: number
          updated_at: string
        }
        Insert: {
          company_id: string
          dia: string
          total?: number
          updated_at?: string
        }
        Update: {
          company_id?: string
          dia?: string
          total?: number
          updated_at?: string
        }
        Relationships: []
      }
      bling_custom_fields: {
        Row: {
          bling_id_campo: string
          company_id: string
          created_at: string
          id: string
          integration_id: string
          nome: string | null
          tipo: string | null
          updated_at: string
        }
        Insert: {
          bling_id_campo: string
          company_id: string
          created_at?: string
          id?: string
          integration_id: string
          nome?: string | null
          tipo?: string | null
          updated_at?: string
        }
        Update: {
          bling_id_campo?: string
          company_id?: string
          created_at?: string
          id?: string
          integration_id?: string
          nome?: string | null
          tipo?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bling_custom_fields_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bling_custom_fields_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: false
            referencedRelation: "bling_integrations"
            referencedColumns: ["id"]
          },
        ]
      }
      bling_custom_fields_import_jobs: {
        Row: {
          cancel_requested: boolean
          company_id: string
          created_at: string
          failed: number
          finished_at: string | null
          id: string
          integration_id: string
          last_error: string | null
          ok: number
          processed: number
          product_ids: string[] | null
          scope: string
          started_at: string | null
          status: string
          total: number
          updated_at: string
        }
        Insert: {
          cancel_requested?: boolean
          company_id: string
          created_at?: string
          failed?: number
          finished_at?: string | null
          id?: string
          integration_id: string
          last_error?: string | null
          ok?: number
          processed?: number
          product_ids?: string[] | null
          scope?: string
          started_at?: string | null
          status?: string
          total?: number
          updated_at?: string
        }
        Update: {
          cancel_requested?: boolean
          company_id?: string
          created_at?: string
          failed?: number
          finished_at?: string | null
          id?: string
          integration_id?: string
          last_error?: string | null
          ok?: number
          processed?: number
          product_ids?: string[] | null
          scope?: string
          started_at?: string | null
          status?: string
          total?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bling_custom_fields_import_jobs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bling_custom_fields_import_jobs_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: false
            referencedRelation: "bling_integrations"
            referencedColumns: ["id"]
          },
        ]
      }
      bling_integrations: {
        Row: {
          access_token: string | null
          bling_account_id: string | null
          client_id: string | null
          client_secret: string | null
          oauth_app_nome: string | null
          company_id: string
          created_at: string
          default_deposito_id: string | null
          id: string
          last_error: string | null
          last_refresh_attempt_at: string | null
          last_sync_at: string | null
          nome_conexao: string | null
          refresh_token: string | null
          scopes: string | null
          status: string
          token_expires_at: string | null
          updated_at: string
        }
        Insert: {
          access_token?: string | null
          bling_account_id?: string | null
          client_id?: string | null
          client_secret?: string | null
          oauth_app_nome?: string | null
          company_id: string
          created_at?: string
          default_deposito_id?: string | null
          id?: string
          last_error?: string | null
          last_refresh_attempt_at?: string | null
          last_sync_at?: string | null
          nome_conexao?: string | null
          refresh_token?: string | null
          scopes?: string | null
          status?: string
          token_expires_at?: string | null
          updated_at?: string
        }
        Update: {
          access_token?: string | null
          bling_account_id?: string | null
          client_id?: string | null
          client_secret?: string | null
          oauth_app_nome?: string | null
          company_id?: string
          created_at?: string
          default_deposito_id?: string | null
          id?: string
          last_error?: string | null
          last_refresh_attempt_at?: string | null
          last_sync_at?: string | null
          nome_conexao?: string | null
          refresh_token?: string | null
          scopes?: string | null
          status?: string
          token_expires_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bling_integrations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      bling_oauth_apps: {
        Row: {
          client_id: string
          client_secret: string
          created_at: string
          id: string
          nome: string
          updated_at: string
        }
        Insert: {
          client_id: string
          client_secret: string
          created_at?: string
          id?: string
          nome: string
          updated_at?: string
        }
        Update: {
          client_id?: string
          client_secret?: string
          created_at?: string
          id?: string
          nome?: string
          updated_at?: string
        }
        Relationships: []
      }
      bling_oauth_states: {
        Row: {
          company_id: string
          created_at: string
          expires_at: string
          id: string
          integration_id: string | null
          state: string
          used_at: string | null
          user_id: string
        }
        Insert: {
          company_id: string
          created_at?: string
          expires_at?: string
          id?: string
          integration_id?: string | null
          state: string
          used_at?: string | null
          user_id: string
        }
        Update: {
          company_id?: string
          created_at?: string
          expires_at?: string
          id?: string
          integration_id?: string | null
          state?: string
          used_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bling_oauth_states_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bling_oauth_states_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: false
            referencedRelation: "bling_integrations"
            referencedColumns: ["id"]
          },
        ]
      }
      bling_order_items: {
        Row: {
          bling_product_id: string | null
          codigo: string | null
          company_id: string
          created_at: string
          custo_total: number
          custo_unitario: number
          desconto: number
          descricao: string | null
          id: string
          order_id: string
          product_id: string | null
          quantidade: number
          total: number
          valor_unitario: number
        }
        Insert: {
          bling_product_id?: string | null
          codigo?: string | null
          company_id: string
          created_at?: string
          custo_total?: number
          custo_unitario?: number
          desconto?: number
          descricao?: string | null
          id?: string
          order_id: string
          product_id?: string | null
          quantidade?: number
          total?: number
          valor_unitario?: number
        }
        Update: {
          bling_product_id?: string | null
          codigo?: string | null
          company_id?: string
          created_at?: string
          custo_total?: number
          custo_unitario?: number
          desconto?: number
          descricao?: string | null
          id?: string
          order_id?: string
          product_id?: string | null
          quantidade?: number
          total?: number
          valor_unitario?: number
        }
        Relationships: [
          {
            foreignKeyName: "bling_order_items_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bling_order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "bling_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bling_order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "bling_products"
            referencedColumns: ["id"]
          },
        ]
      }
      bling_orders: {
        Row: {
          bling_order_id: string
          bling_updated_at: string | null
          cidade: string | null
          company_id: string
          contato_documento: string | null
          contato_id: string | null
          contato_nome: string | null
          created_at: string
          custo_total: number
          data: string | null
          data_saida: string | null
          desconto: number
          frete: number
          id: string
          integration_id: string | null
          intermediador_cnpj: string | null
          intermediador_nome: string | null
          intermediador_razao_social: string | null
          items_count: number
          items_synced: boolean
          loja_id: string | null
          loja_nome: string | null
          numero: string | null
          numero_loja: string | null
          outras_despesas: number
          raw_json: Json | null
          situacao_id: string | null
          situacao_nome: string | null
          taxa_percent: number | null
          total: number
          total_produtos: number
          uf: string | null
          updated_at: string
        }
        Insert: {
          bling_order_id: string
          bling_updated_at?: string | null
          cidade?: string | null
          company_id: string
          contato_documento?: string | null
          contato_id?: string | null
          contato_nome?: string | null
          created_at?: string
          custo_total?: number
          data?: string | null
          data_saida?: string | null
          desconto?: number
          frete?: number
          id?: string
          integration_id?: string | null
          intermediador_cnpj?: string | null
          intermediador_nome?: string | null
          intermediador_razao_social?: string | null
          items_count?: number
          items_synced?: boolean
          loja_id?: string | null
          loja_nome?: string | null
          numero?: string | null
          numero_loja?: string | null
          outras_despesas?: number
          raw_json?: Json | null
          situacao_id?: string | null
          situacao_nome?: string | null
          taxa_percent?: number | null
          total?: number
          total_produtos?: number
          uf?: string | null
          updated_at?: string
        }
        Update: {
          bling_order_id?: string
          bling_updated_at?: string | null
          cidade?: string | null
          company_id?: string
          contato_documento?: string | null
          contato_id?: string | null
          contato_nome?: string | null
          created_at?: string
          custo_total?: number
          data?: string | null
          data_saida?: string | null
          desconto?: number
          frete?: number
          id?: string
          integration_id?: string | null
          intermediador_cnpj?: string | null
          intermediador_nome?: string | null
          intermediador_razao_social?: string | null
          items_count?: number
          items_synced?: boolean
          loja_id?: string | null
          loja_nome?: string | null
          numero?: string | null
          numero_loja?: string | null
          outras_despesas?: number
          raw_json?: Json | null
          situacao_id?: string | null
          situacao_nome?: string | null
          taxa_percent?: number | null
          total?: number
          total_produtos?: number
          uf?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bling_orders_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bling_orders_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: false
            referencedRelation: "bling_integrations"
            referencedColumns: ["id"]
          },
        ]
      }
      bling_orders_sync_jobs: {
        Row: {
          cancel_requested: boolean
          changed_since: string | null
          claimed_at: string | null
          company_id: string
          created_at: string
          current_page: number
          date_from: string | null
          errors: number
          finished_at: string | null
          id: string
          integration_id: string
          items_saved: number
          last_error: string | null
          mode: string
          orders_found: number
          orders_new: number
          orders_skipped: number
          orders_updated: number
          pages_processed: number
          requests_made: number
          run_started_at: string
          started_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          cancel_requested?: boolean
          changed_since?: string | null
          claimed_at?: string | null
          company_id: string
          created_at?: string
          current_page?: number
          date_from?: string | null
          errors?: number
          finished_at?: string | null
          id?: string
          integration_id: string
          items_saved?: number
          last_error?: string | null
          mode?: string
          orders_found?: number
          orders_new?: number
          orders_skipped?: number
          orders_updated?: number
          pages_processed?: number
          requests_made?: number
          run_started_at?: string
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          cancel_requested?: boolean
          changed_since?: string | null
          claimed_at?: string | null
          company_id?: string
          created_at?: string
          current_page?: number
          date_from?: string | null
          errors?: number
          finished_at?: string | null
          id?: string
          integration_id?: string
          items_saved?: number
          last_error?: string | null
          mode?: string
          orders_found?: number
          orders_new?: number
          orders_skipped?: number
          orders_updated?: number
          pages_processed?: number
          requests_made?: number
          run_started_at?: string
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bling_orders_sync_jobs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bling_orders_sync_jobs_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: false
            referencedRelation: "bling_integrations"
            referencedColumns: ["id"]
          },
        ]
      }
      bling_orders_sync_state: {
        Row: {
          company_id: string
          created_at: string
          last_order_date: string | null
          last_synced_at: string | null
          total_orders: number
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          last_order_date?: string | null
          last_synced_at?: string | null
          total_orders?: number
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          last_order_date?: string | null
          last_synced_at?: string | null
          total_orders?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bling_orders_sync_state_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      bling_product_custom_values: {
        Row: {
          company_id: string
          created_at: string
          custom_field_id: string
          dirty: boolean
          id: string
          id_vinculo: string | null
          product_id: string
          updated_at: string
          valor: string | null
        }
        Insert: {
          company_id: string
          created_at?: string
          custom_field_id: string
          dirty?: boolean
          id?: string
          id_vinculo?: string | null
          product_id: string
          updated_at?: string
          valor?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string
          custom_field_id?: string
          dirty?: boolean
          id?: string
          id_vinculo?: string | null
          product_id?: string
          updated_at?: string
          valor?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bling_product_custom_values_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bling_product_custom_values_custom_field_id_fkey"
            columns: ["custom_field_id"]
            isOneToOne: false
            referencedRelation: "bling_custom_fields"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bling_product_custom_values_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "bling_products"
            referencedColumns: ["id"]
          },
        ]
      }
      bling_product_deposit_stock: {
        Row: {
          bling_deposit_id: string
          company_id: string
          estoque_alvo: number
          pendente: boolean
          product_id: string
          sincronizado_em: string | null
          ultimo_estoque_sincronizado: number | null
          updated_at: string
        }
        Insert: {
          bling_deposit_id: string
          company_id: string
          estoque_alvo?: number
          pendente?: boolean
          product_id: string
          sincronizado_em?: string | null
          ultimo_estoque_sincronizado?: number | null
          updated_at?: string
        }
        Update: {
          bling_deposit_id?: string
          company_id?: string
          estoque_alvo?: number
          pendente?: boolean
          product_id?: string
          sincronizado_em?: string | null
          ultimo_estoque_sincronizado?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      bling_product_stores: {
        Row: {
          bling_product_id: string
          bling_product_store_id: string
          bling_store_id: string
          brand_store_id: string | null
          categories_json: Json | null
          company_id: string
          created_at: string
          current_price: number | null
          current_promotional_price: number | null
          id: string
          integration_id: string
          intermediador_cnpj: string | null
          intermediador_nome: string | null
          internal_product_id: string | null
          is_linked: boolean
          last_bling_update_at: string | null
          last_imported_at: string
          last_seen_run_id: string | null
          raw_data_json: Json | null
          sincronizado_em: string | null
          store_name: string | null
          store_product_code: string | null
          store_type: string | null
          supplier_store_id: string | null
          sync_error: string | null
          sync_status: string
          ultimo_preco_sincronizado: number | null
          updated_at: string
        }
        Insert: {
          bling_product_id: string
          bling_product_store_id: string
          bling_store_id: string
          brand_store_id?: string | null
          categories_json?: Json | null
          company_id: string
          created_at?: string
          current_price?: number | null
          current_promotional_price?: number | null
          id?: string
          integration_id: string
          intermediador_cnpj?: string | null
          intermediador_nome?: string | null
          internal_product_id?: string | null
          is_linked?: boolean
          last_bling_update_at?: string | null
          last_imported_at?: string
          last_seen_run_id?: string | null
          raw_data_json?: Json | null
          sincronizado_em?: string | null
          store_name?: string | null
          store_product_code?: string | null
          store_type?: string | null
          supplier_store_id?: string | null
          sync_error?: string | null
          sync_status?: string
          ultimo_preco_sincronizado?: number | null
          updated_at?: string
        }
        Update: {
          bling_product_id?: string
          bling_product_store_id?: string
          bling_store_id?: string
          brand_store_id?: string | null
          categories_json?: Json | null
          company_id?: string
          created_at?: string
          current_price?: number | null
          current_promotional_price?: number | null
          id?: string
          integration_id?: string
          intermediador_cnpj?: string | null
          intermediador_nome?: string | null
          internal_product_id?: string | null
          is_linked?: boolean
          last_bling_update_at?: string | null
          last_imported_at?: string
          last_seen_run_id?: string | null
          raw_data_json?: Json | null
          sincronizado_em?: string | null
          store_name?: string | null
          store_product_code?: string | null
          store_type?: string | null
          supplier_store_id?: string | null
          sync_error?: string | null
          sync_status?: string
          ultimo_preco_sincronizado?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bling_product_stores_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bling_product_stores_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: false
            referencedRelation: "bling_integrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bling_product_stores_internal_product_id_fkey"
            columns: ["internal_product_id"]
            isOneToOne: false
            referencedRelation: "bling_products"
            referencedColumns: ["id"]
          },
        ]
      }
      bling_products: {
        Row: {
          altura: number | null
          bling_created_at: string | null
          bling_deposit_id: string | null
          bling_product_id: string | null
          bling_updated_at: string | null
          categoria_id: string | null
          categoria_produto: string | null
          cest: string | null
          classe_ipi: string | null
          clonar_dados_pai: string | null
          cod_fornecedor: string | null
          codigo: string | null
          codigo_integracao: string | null
          codigo_lista_servicos: string | null
          codigo_pai: string | null
          company_id: string
          condicao_produto: string | null
          created_at: string
          cross_docking: string | null
          dados_completos_json: Json | null
          dados_resumidos_json: Json | null
          data_validade: string | null
          departamento: string | null
          descricao_complementar: string | null
          descricao_curta: string | null
          descricao_fornecedor: string | null
          detail_sync_error: string | null
          detail_synced: boolean
          detail_synced_at: string | null
          dirty: boolean
          estoque: number | null
          estoque_maximo: number | null
          estoque_minimo: number | null
          formato: string | null
          fornecedor: string | null
          fornecedor_id: string | null
          frete_gratis: string | null
          garantia: string | null
          grupo_produtos: string | null
          grupo_tags: string | null
          gtin: string | null
          gtin_embalagem: string | null
          icms_proprio_substituto: number | null
          icms_st_base: number | null
          icms_st_retencao: number | null
          id: string
          imagem_principal_url: string | null
          informacoes_adicionais: string | null
          integration_id: string | null
          itens_caixa: number | null
          largura: number | null
          last_audit_at: string | null
          last_audit_errors: number
          last_audit_passed: number
          last_audit_warnings: number
          last_imported_at: string | null
          last_seen_sync_job_id: string | null
          link_externo: string | null
          localizacao: string | null
          marca: string | null
          meses_garantia_fornecedor: string | null
          ncm: string | null
          nome: string | null
          numero_fci: string | null
          observacoes: string | null
          origem_fiscal: string | null
          peso_bruto: number | null
          peso_liquido: number | null
          preco: number | null
          preco_compra: number | null
          preco_custo: number | null
          produto_variacao: string | null
          profundidade: number | null
          sheet_data_json: Json | null
          sincronizacao_erro: string | null
          sincronizacao_status: string | null
          sincronizado_em: string | null
          situacao: string | null
          source: string
          tipo: string | null
          tipo_item: string | null
          tipo_producao: string | null
          tributos: string | null
          ultimo_estoque_sincronizado: number | null
          ultimo_preco_sincronizado: number | null
          unidade: string | null
          unidade_medida: string | null
          updated_at: string
          url_imagens_externas: string | null
          valor_ipi_fixo: number | null
          video: string | null
          volumes: number | null
        }
        Insert: {
          altura?: number | null
          bling_created_at?: string | null
          bling_deposit_id?: string | null
          bling_product_id?: string | null
          bling_updated_at?: string | null
          categoria_id?: string | null
          categoria_produto?: string | null
          cest?: string | null
          classe_ipi?: string | null
          clonar_dados_pai?: string | null
          cod_fornecedor?: string | null
          codigo?: string | null
          codigo_integracao?: string | null
          codigo_lista_servicos?: string | null
          codigo_pai?: string | null
          company_id: string
          condicao_produto?: string | null
          created_at?: string
          cross_docking?: string | null
          dados_completos_json?: Json | null
          dados_resumidos_json?: Json | null
          data_validade?: string | null
          departamento?: string | null
          descricao_complementar?: string | null
          descricao_curta?: string | null
          descricao_fornecedor?: string | null
          detail_sync_error?: string | null
          detail_synced?: boolean
          detail_synced_at?: string | null
          dirty?: boolean
          estoque?: number | null
          estoque_maximo?: number | null
          estoque_minimo?: number | null
          formato?: string | null
          fornecedor?: string | null
          fornecedor_id?: string | null
          frete_gratis?: string | null
          garantia?: string | null
          grupo_produtos?: string | null
          grupo_tags?: string | null
          gtin?: string | null
          gtin_embalagem?: string | null
          icms_proprio_substituto?: number | null
          icms_st_base?: number | null
          icms_st_retencao?: number | null
          id?: string
          imagem_principal_url?: string | null
          informacoes_adicionais?: string | null
          integration_id?: string | null
          itens_caixa?: number | null
          largura?: number | null
          last_audit_at?: string | null
          last_audit_errors?: number
          last_audit_passed?: number
          last_audit_warnings?: number
          last_imported_at?: string | null
          last_seen_sync_job_id?: string | null
          link_externo?: string | null
          localizacao?: string | null
          marca?: string | null
          meses_garantia_fornecedor?: string | null
          ncm?: string | null
          nome?: string | null
          numero_fci?: string | null
          observacoes?: string | null
          origem_fiscal?: string | null
          peso_bruto?: number | null
          peso_liquido?: number | null
          preco?: number | null
          preco_compra?: number | null
          preco_custo?: number | null
          produto_variacao?: string | null
          profundidade?: number | null
          sheet_data_json?: Json | null
          sincronizacao_erro?: string | null
          sincronizacao_status?: string | null
          sincronizado_em?: string | null
          situacao?: string | null
          source?: string
          tipo?: string | null
          tipo_item?: string | null
          tipo_producao?: string | null
          tributos?: string | null
          ultimo_estoque_sincronizado?: number | null
          ultimo_preco_sincronizado?: number | null
          unidade?: string | null
          unidade_medida?: string | null
          updated_at?: string
          url_imagens_externas?: string | null
          valor_ipi_fixo?: number | null
          video?: string | null
          volumes?: number | null
        }
        Update: {
          altura?: number | null
          bling_created_at?: string | null
          bling_deposit_id?: string | null
          bling_product_id?: string | null
          bling_updated_at?: string | null
          categoria_id?: string | null
          categoria_produto?: string | null
          cest?: string | null
          classe_ipi?: string | null
          clonar_dados_pai?: string | null
          cod_fornecedor?: string | null
          codigo?: string | null
          codigo_integracao?: string | null
          codigo_lista_servicos?: string | null
          codigo_pai?: string | null
          company_id?: string
          condicao_produto?: string | null
          created_at?: string
          cross_docking?: string | null
          dados_completos_json?: Json | null
          dados_resumidos_json?: Json | null
          data_validade?: string | null
          departamento?: string | null
          descricao_complementar?: string | null
          descricao_curta?: string | null
          descricao_fornecedor?: string | null
          detail_sync_error?: string | null
          detail_synced?: boolean
          detail_synced_at?: string | null
          dirty?: boolean
          estoque?: number | null
          estoque_maximo?: number | null
          estoque_minimo?: number | null
          formato?: string | null
          fornecedor?: string | null
          fornecedor_id?: string | null
          frete_gratis?: string | null
          garantia?: string | null
          grupo_produtos?: string | null
          grupo_tags?: string | null
          gtin?: string | null
          gtin_embalagem?: string | null
          icms_proprio_substituto?: number | null
          icms_st_base?: number | null
          icms_st_retencao?: number | null
          id?: string
          imagem_principal_url?: string | null
          informacoes_adicionais?: string | null
          integration_id?: string | null
          itens_caixa?: number | null
          largura?: number | null
          last_audit_at?: string | null
          last_audit_errors?: number
          last_audit_passed?: number
          last_audit_warnings?: number
          last_imported_at?: string | null
          last_seen_sync_job_id?: string | null
          link_externo?: string | null
          localizacao?: string | null
          marca?: string | null
          meses_garantia_fornecedor?: string | null
          ncm?: string | null
          nome?: string | null
          numero_fci?: string | null
          observacoes?: string | null
          origem_fiscal?: string | null
          peso_bruto?: number | null
          peso_liquido?: number | null
          preco?: number | null
          preco_compra?: number | null
          preco_custo?: number | null
          produto_variacao?: string | null
          profundidade?: number | null
          sheet_data_json?: Json | null
          sincronizacao_erro?: string | null
          sincronizacao_status?: string | null
          sincronizado_em?: string | null
          situacao?: string | null
          source?: string
          tipo?: string | null
          tipo_item?: string | null
          tipo_producao?: string | null
          tributos?: string | null
          ultimo_estoque_sincronizado?: number | null
          ultimo_preco_sincronizado?: number | null
          unidade?: string | null
          unidade_medida?: string | null
          updated_at?: string
          url_imagens_externas?: string | null
          valor_ipi_fixo?: number | null
          video?: string | null
          volumes?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "bling_products_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bling_products_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: false
            referencedRelation: "bling_integrations"
            referencedColumns: ["id"]
          },
        ]
      }
      bling_push_queue: {
        Row: {
          bling_deposit_id: string | null
          bling_product_id: string | null
          bling_product_store_id: string | null
          claimed_at: string | null
          company_id: string
          created_at: string
          erro: string | null
          id: string
          integration_id: string
          last_response_body_safe: string | null
          last_response_status: number | null
          payload: Json | null
          processed_at: string | null
          product_id: string
          proxima_tentativa_em: string
          status: string
          tentativas: number
          tipo: string
          updated_at: string
          valor_anterior: number | null
          valor_novo: number
        }
        Insert: {
          bling_deposit_id?: string | null
          bling_product_id?: string | null
          bling_product_store_id?: string | null
          claimed_at?: string | null
          company_id: string
          created_at?: string
          erro?: string | null
          id?: string
          integration_id: string
          last_response_body_safe?: string | null
          last_response_status?: number | null
          payload?: Json | null
          processed_at?: string | null
          product_id: string
          proxima_tentativa_em?: string
          status?: string
          tentativas?: number
          tipo: string
          updated_at?: string
          valor_anterior?: number | null
          valor_novo: number
        }
        Update: {
          bling_deposit_id?: string | null
          bling_product_id?: string | null
          bling_product_store_id?: string | null
          claimed_at?: string | null
          company_id?: string
          created_at?: string
          erro?: string | null
          id?: string
          integration_id?: string
          last_response_body_safe?: string | null
          last_response_status?: number | null
          payload?: Json | null
          processed_at?: string | null
          product_id?: string
          proxima_tentativa_em?: string
          status?: string
          tentativas?: number
          tipo?: string
          updated_at?: string
          valor_anterior?: number | null
          valor_novo?: number
        }
        Relationships: [
          {
            foreignKeyName: "bling_push_queue_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bling_push_queue_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: false
            referencedRelation: "bling_integrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bling_push_queue_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "bling_products"
            referencedColumns: ["id"]
          },
        ]
      }
      bling_stock_deposits: {
        Row: {
          ativo: boolean
          bling_deposit_id: string
          company_id: string
          descricao: string | null
          modo: string
          padrao: boolean
          synced_at: string | null
          updated_at: string
          zerar_fornecedores: string[]
        }
        Insert: {
          ativo?: boolean
          bling_deposit_id: string
          company_id: string
          descricao?: string | null
          modo?: string
          padrao?: boolean
          synced_at?: string | null
          updated_at?: string
          zerar_fornecedores?: string[]
        }
        Update: {
          ativo?: boolean
          bling_deposit_id?: string
          company_id?: string
          descricao?: string | null
          modo?: string
          padrao?: boolean
          synced_at?: string | null
          updated_at?: string
          zerar_fornecedores?: string[]
        }
        Relationships: []
      }
      bling_store_sync_jobs: {
        Row: {
          bling_product_id: string | null
          cancel_requested: boolean
          claimed_at: string | null
          company_id: string
          created_at: string
          erros: number
          finished_at: string | null
          id: string
          integration_id: string
          last_error: string | null
          paginas_processadas: number
          produtos_nao_encontrados: number
          produtos_relacionados: number
          proxima_pagina: number
          scope: string
          started_at: string | null
          status: string
          total_estimate: number | null
          total_paginas: number | null
          updated_at: string
          vinculos_atualizados: number
          vinculos_encontrados: number
          vinculos_salvos: number
        }
        Insert: {
          bling_product_id?: string | null
          cancel_requested?: boolean
          claimed_at?: string | null
          company_id: string
          created_at?: string
          erros?: number
          finished_at?: string | null
          id?: string
          integration_id: string
          last_error?: string | null
          paginas_processadas?: number
          produtos_nao_encontrados?: number
          produtos_relacionados?: number
          proxima_pagina?: number
          scope?: string
          started_at?: string | null
          status?: string
          total_estimate?: number | null
          total_paginas?: number | null
          updated_at?: string
          vinculos_atualizados?: number
          vinculos_encontrados?: number
          vinculos_salvos?: number
        }
        Update: {
          bling_product_id?: string | null
          cancel_requested?: boolean
          claimed_at?: string | null
          company_id?: string
          created_at?: string
          erros?: number
          finished_at?: string | null
          id?: string
          integration_id?: string
          last_error?: string | null
          paginas_processadas?: number
          produtos_nao_encontrados?: number
          produtos_relacionados?: number
          proxima_pagina?: number
          scope?: string
          started_at?: string | null
          status?: string
          total_estimate?: number | null
          total_paginas?: number | null
          updated_at?: string
          vinculos_atualizados?: number
          vinculos_encontrados?: number
          vinculos_salvos?: number
        }
        Relationships: [
          {
            foreignKeyName: "bling_store_sync_jobs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bling_store_sync_jobs_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: false
            referencedRelation: "bling_integrations"
            referencedColumns: ["id"]
          },
        ]
      }
      bling_stores: {
        Row: {
          agrupador: number | null
          bling_store_id: string
          cnpj_filial: string | null
          company_id: string
          created_at: string
          descricao: string | null
          id: string
          integration_id: string
          intermediador_cnpj: string | null
          intermediador_nome: string | null
          is_default: boolean
          last_imported_at: string | null
          marketplace_id: string | null
          raw_json: Json | null
          situacao: number | null
          tipo: string | null
          unidade_negocio: string | null
          updated_at: string
        }
        Insert: {
          agrupador?: number | null
          bling_store_id: string
          cnpj_filial?: string | null
          company_id: string
          created_at?: string
          descricao?: string | null
          id?: string
          integration_id: string
          intermediador_cnpj?: string | null
          intermediador_nome?: string | null
          is_default?: boolean
          last_imported_at?: string | null
          marketplace_id?: string | null
          raw_json?: Json | null
          situacao?: number | null
          tipo?: string | null
          unidade_negocio?: string | null
          updated_at?: string
        }
        Update: {
          agrupador?: number | null
          bling_store_id?: string
          cnpj_filial?: string | null
          company_id?: string
          created_at?: string
          descricao?: string | null
          id?: string
          integration_id?: string
          intermediador_cnpj?: string | null
          intermediador_nome?: string | null
          is_default?: boolean
          last_imported_at?: string | null
          marketplace_id?: string | null
          raw_json?: Json | null
          situacao?: number | null
          tipo?: string | null
          unidade_negocio?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bling_stores_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bling_stores_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: false
            referencedRelation: "bling_integrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bling_stores_marketplace_id_fkey"
            columns: ["marketplace_id"]
            isOneToOne: false
            referencedRelation: "marketplaces"
            referencedColumns: ["id"]
          },
        ]
      }
      bling_sync_job_errors: {
        Row: {
          attempts: number
          bling_product_id: string | null
          company_id: string
          created_at: string
          endpoint: string | null
          error_code: string | null
          error_message: string | null
          http_status: number | null
          id: string
          integration_id: string
          phase: string | null
          resolved: boolean
          sync_job_id: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          bling_product_id?: string | null
          company_id: string
          created_at?: string
          endpoint?: string | null
          error_code?: string | null
          error_message?: string | null
          http_status?: number | null
          id?: string
          integration_id: string
          phase?: string | null
          resolved?: boolean
          sync_job_id: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          bling_product_id?: string | null
          company_id?: string
          created_at?: string
          endpoint?: string | null
          error_code?: string | null
          error_message?: string | null
          http_status?: number | null
          id?: string
          integration_id?: string
          phase?: string | null
          resolved?: boolean
          sync_job_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bling_sync_job_errors_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bling_sync_job_errors_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: false
            referencedRelation: "bling_integrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bling_sync_job_errors_sync_job_id_fkey"
            columns: ["sync_job_id"]
            isOneToOne: false
            referencedRelation: "bling_sync_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      bling_sync_jobs: {
        Row: {
          average_seconds_per_item: number | null
          cancel_requested: boolean
          catalog_finished_at: string | null
          cataloged_items: number
          claimed_at: string | null
          claimed_by: string | null
          company_id: string
          consecutive_errors: number
          created_at: string
          created_by: string | null
          current_page: number
          elapsed_seconds: number | null
          estimated_finish_at: string | null
          estimated_remaining_seconds: number | null
          failed_items: number
          finished_at: string | null
          id: string
          integration_id: string
          last_activity_at: string | null
          last_error_code: string | null
          last_error_message: string | null
          last_product_id: string | null
          last_request_at: string | null
          last_request_endpoint: string | null
          last_response_body_safe: string | null
          last_response_status: number | null
          page_size: number
          pause_reason: string | null
          phase: string
          processed_items: number
          progress_percent: number
          remaining_items: number | null
          requests_made: number
          resource: string
          retries_count: number
          started_at: string | null
          status: string
          successful_items: number
          sync_type: string
          total_items: number | null
          total_pages_processed: number
          updated_at: string
          worker_finished_at: string | null
          worker_invocation_count: number
          worker_last_error: string | null
          worker_last_heartbeat_at: string | null
          worker_last_status: string | null
          worker_started_at: string | null
        }
        Insert: {
          average_seconds_per_item?: number | null
          cancel_requested?: boolean
          catalog_finished_at?: string | null
          cataloged_items?: number
          claimed_at?: string | null
          claimed_by?: string | null
          company_id: string
          consecutive_errors?: number
          created_at?: string
          created_by?: string | null
          current_page?: number
          elapsed_seconds?: number | null
          estimated_finish_at?: string | null
          estimated_remaining_seconds?: number | null
          failed_items?: number
          finished_at?: string | null
          id?: string
          integration_id: string
          last_activity_at?: string | null
          last_error_code?: string | null
          last_error_message?: string | null
          last_product_id?: string | null
          last_request_at?: string | null
          last_request_endpoint?: string | null
          last_response_body_safe?: string | null
          last_response_status?: number | null
          page_size?: number
          pause_reason?: string | null
          phase?: string
          processed_items?: number
          progress_percent?: number
          remaining_items?: number | null
          requests_made?: number
          resource?: string
          retries_count?: number
          started_at?: string | null
          status?: string
          successful_items?: number
          sync_type?: string
          total_items?: number | null
          total_pages_processed?: number
          updated_at?: string
          worker_finished_at?: string | null
          worker_invocation_count?: number
          worker_last_error?: string | null
          worker_last_heartbeat_at?: string | null
          worker_last_status?: string | null
          worker_started_at?: string | null
        }
        Update: {
          average_seconds_per_item?: number | null
          cancel_requested?: boolean
          catalog_finished_at?: string | null
          cataloged_items?: number
          claimed_at?: string | null
          claimed_by?: string | null
          company_id?: string
          consecutive_errors?: number
          created_at?: string
          created_by?: string | null
          current_page?: number
          elapsed_seconds?: number | null
          estimated_finish_at?: string | null
          estimated_remaining_seconds?: number | null
          failed_items?: number
          finished_at?: string | null
          id?: string
          integration_id?: string
          last_activity_at?: string | null
          last_error_code?: string | null
          last_error_message?: string | null
          last_product_id?: string | null
          last_request_at?: string | null
          last_request_endpoint?: string | null
          last_response_body_safe?: string | null
          last_response_status?: number | null
          page_size?: number
          pause_reason?: string | null
          phase?: string
          processed_items?: number
          progress_percent?: number
          remaining_items?: number | null
          requests_made?: number
          resource?: string
          retries_count?: number
          started_at?: string | null
          status?: string
          successful_items?: number
          sync_type?: string
          total_items?: number | null
          total_pages_processed?: number
          updated_at?: string
          worker_finished_at?: string | null
          worker_invocation_count?: number
          worker_last_error?: string | null
          worker_last_heartbeat_at?: string | null
          worker_last_status?: string | null
          worker_started_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bling_sync_jobs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bling_sync_jobs_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: false
            referencedRelation: "bling_integrations"
            referencedColumns: ["id"]
          },
        ]
      }
      companies: {
        Row: {
          cnpj: string | null
          created_at: string
          id: string
          nome: string
          nome_fantasia: string | null
          owner_user_id: string
          status: string
          updated_at: string
        }
        Insert: {
          cnpj?: string | null
          created_at?: string
          id?: string
          nome: string
          nome_fantasia?: string | null
          owner_user_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          cnpj?: string | null
          created_at?: string
          id?: string
          nome?: string
          nome_fantasia?: string | null
          owner_user_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      company_users: {
        Row: {
          ativo: boolean
          company_id: string
          created_at: string
          id: string
          role: string
          user_id: string
        }
        Insert: {
          ativo?: boolean
          company_id: string
          created_at?: string
          id?: string
          role?: string
          user_id: string
        }
        Update: {
          ativo?: boolean
          company_id?: string
          created_at?: string
          id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_users_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      dre_expenses: {
        Row: {
          categoria: string
          company_id: string
          competencia: string
          created_at: string
          created_by: string | null
          descricao: string | null
          id: string
          tipo: string
          updated_at: string
          valor: number
        }
        Insert: {
          categoria: string
          company_id: string
          competencia: string
          created_at?: string
          created_by?: string | null
          descricao?: string | null
          id?: string
          tipo?: string
          updated_at?: string
          valor?: number
        }
        Update: {
          categoria?: string
          company_id?: string
          competencia?: string
          created_at?: string
          created_by?: string | null
          descricao?: string | null
          id?: string
          tipo?: string
          updated_at?: string
          valor?: number
        }
        Relationships: [
          {
            foreignKeyName: "dre_expenses_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      fornecedor_produtos: {
        Row: {
          altura: number | null
          ativo: boolean
          categoria: string | null
          codigo: string
          codigobarras: string | null
          comprimento: number | null
          created_at: string
          descricao_tecnica: string | null
          estoque: string | null
          faturamento: string | null
          fornecedor_id: string
          foto: string | null
          id: string
          ipi: number | null
          largura: number | null
          marca: string | null
          mpdobem: string | null
          multiplo: number | null
          ncm: string | null
          nome_nota: string | null
          origem: string | null
          peso: number | null
          ppb: string | null
          precos: Json | null
          qt_estoque: number | null
          raw: Json | null
          tempo_garantia: string | null
          titulo: string | null
          unidade: string | null
          updated_at: string
        }
        Insert: {
          altura?: number | null
          ativo?: boolean
          categoria?: string | null
          codigo: string
          codigobarras?: string | null
          comprimento?: number | null
          created_at?: string
          descricao_tecnica?: string | null
          estoque?: string | null
          faturamento?: string | null
          fornecedor_id: string
          foto?: string | null
          id?: string
          ipi?: number | null
          largura?: number | null
          marca?: string | null
          mpdobem?: string | null
          multiplo?: number | null
          ncm?: string | null
          nome_nota?: string | null
          origem?: string | null
          peso?: number | null
          ppb?: string | null
          precos?: Json | null
          qt_estoque?: number | null
          raw?: Json | null
          tempo_garantia?: string | null
          titulo?: string | null
          unidade?: string | null
          updated_at?: string
        }
        Update: {
          altura?: number | null
          ativo?: boolean
          categoria?: string | null
          codigo?: string
          codigobarras?: string | null
          comprimento?: number | null
          created_at?: string
          descricao_tecnica?: string | null
          estoque?: string | null
          faturamento?: string | null
          fornecedor_id?: string
          foto?: string | null
          id?: string
          ipi?: number | null
          largura?: number | null
          marca?: string | null
          mpdobem?: string | null
          multiplo?: number | null
          ncm?: string | null
          nome_nota?: string | null
          origem?: string | null
          peso?: number | null
          ppb?: string | null
          precos?: Json | null
          qt_estoque?: number | null
          raw?: Json | null
          tempo_garantia?: string | null
          titulo?: string | null
          unidade?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fornecedor_produtos_fornecedor_id_fkey"
            columns: ["fornecedor_id"]
            isOneToOne: false
            referencedRelation: "fornecedores"
            referencedColumns: ["id"]
          },
        ]
      }
      fornecedores: {
        Row: {
          codigo: string
          company_id: string | null
          created_at: string
          id: string
          last_sync_at: string | null
          last_sync_error: string | null
          last_sync_status: string | null
          nome: string
          preco_embalagem: number
          preco_transporte: number
          product_count: number
          source_type: string
          source_url: string | null
          stock_cap: number | null
          sync_cursor: number | null
          sync_started_at: string | null
          taxa_devolucao: number
          taxa_promocao: number
          updated_at: string
        }
        Insert: {
          codigo: string
          company_id?: string | null
          created_at?: string
          id?: string
          last_sync_at?: string | null
          last_sync_error?: string | null
          last_sync_status?: string | null
          nome: string
          preco_embalagem?: number
          preco_transporte?: number
          product_count?: number
          source_type?: string
          source_url?: string | null
          stock_cap?: number | null
          sync_cursor?: number | null
          sync_started_at?: string | null
          taxa_devolucao?: number
          taxa_promocao?: number
          updated_at?: string
        }
        Update: {
          codigo?: string
          company_id?: string | null
          created_at?: string
          id?: string
          last_sync_at?: string | null
          last_sync_error?: string | null
          last_sync_status?: string | null
          nome?: string
          preco_embalagem?: number
          preco_transporte?: number
          product_count?: number
          source_type?: string
          source_url?: string | null
          stock_cap?: number | null
          sync_cursor?: number | null
          sync_started_at?: string | null
          taxa_devolucao?: number
          taxa_promocao?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fornecedores_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      import_batches: {
        Row: {
          applied_at: string | null
          apply_processed: number
          apply_total: number
          classify_processed: number
          classify_total: number
          company_id: string
          created_at: string
          duration_ms: number | null
          error_count: number
          errors: Json
          existing_count: number
          files: Json
          finished_at: string | null
          id: string
          ignored_count: number
          new_count: number
          processed_files: number
          processed_rows: number
          started_at: string | null
          status: string
          total_files: number
          total_rows: number
          updated_at: string
          updated_count: number
          user_id: string
        }
        Insert: {
          applied_at?: string | null
          apply_processed?: number
          apply_total?: number
          classify_processed?: number
          classify_total?: number
          company_id: string
          created_at?: string
          duration_ms?: number | null
          error_count?: number
          errors?: Json
          existing_count?: number
          files?: Json
          finished_at?: string | null
          id?: string
          ignored_count?: number
          new_count?: number
          processed_files?: number
          processed_rows?: number
          started_at?: string | null
          status?: string
          total_files?: number
          total_rows?: number
          updated_at?: string
          updated_count?: number
          user_id: string
        }
        Update: {
          applied_at?: string | null
          apply_processed?: number
          apply_total?: number
          classify_processed?: number
          classify_total?: number
          company_id?: string
          created_at?: string
          duration_ms?: number | null
          error_count?: number
          errors?: Json
          existing_count?: number
          files?: Json
          finished_at?: string | null
          id?: string
          ignored_count?: number
          new_count?: number
          processed_files?: number
          processed_rows?: number
          started_at?: string | null
          status?: string
          total_files?: number
          total_rows?: number
          updated_at?: string
          updated_count?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "import_batches_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      marketplaces: {
        Row: {
          created_at: string
          id: string
          nome: string
          taxa_percent: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          nome: string
          taxa_percent?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          nome?: string
          taxa_percent?: number
          updated_at?: string
        }
        Relationships: []
      }
      ml_integration: {
        Row: {
          access_token: string | null
          created_at: string
          id: string
          last_error: string | null
          ml_nickname: string | null
          ml_user_id: string | null
          refresh_token: string | null
          singleton: boolean
          status: string
          token_expires_at: string | null
          updated_at: string
        }
        Insert: {
          access_token?: string | null
          created_at?: string
          id?: string
          last_error?: string | null
          ml_nickname?: string | null
          ml_user_id?: string | null
          refresh_token?: string | null
          singleton?: boolean
          status?: string
          token_expires_at?: string | null
          updated_at?: string
        }
        Update: {
          access_token?: string | null
          created_at?: string
          id?: string
          last_error?: string | null
          ml_nickname?: string | null
          ml_user_id?: string | null
          refresh_token?: string | null
          singleton?: boolean
          status?: string
          token_expires_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      ml_map_jobs: {
        Row: {
          cancel_requested: boolean
          company_id: string
          created_at: string
          cursor_id: string | null
          error: string | null
          finished_at: string | null
          found_count: number
          full_count: number
          id: string
          processed: number
          product_ids: string[] | null
          scope: string
          started_at: string | null
          status: string
          total: number
          updated_at: string
          zip_code: string
        }
        Insert: {
          cancel_requested?: boolean
          company_id: string
          created_at?: string
          cursor_id?: string | null
          error?: string | null
          finished_at?: string | null
          found_count?: number
          full_count?: number
          id?: string
          processed?: number
          product_ids?: string[] | null
          scope?: string
          started_at?: string | null
          status?: string
          total?: number
          updated_at?: string
          zip_code?: string
        }
        Update: {
          cancel_requested?: boolean
          company_id?: string
          created_at?: string
          cursor_id?: string | null
          error?: string | null
          finished_at?: string | null
          found_count?: number
          full_count?: number
          id?: string
          processed?: number
          product_ids?: string[] | null
          scope?: string
          started_at?: string | null
          status?: string
          total?: number
          updated_at?: string
          zip_code?: string
        }
        Relationships: []
      }
      ml_oauth_states: {
        Row: {
          created_at: string
          expires_at: string
          state: string
          used_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at: string
          state: string
          used_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          state?: string
          used_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      ml_product_matches: {
        Row: {
          available_quantity: number | null
          best_is_full: boolean
          best_item_id: string | null
          best_price: number | null
          best_shipping_cost: number | null
          best_total_price: number | null
          checked_at: string
          company_id: string
          ean: string | null
          error: string | null
          found: boolean
          full_offers: number
          has_full: boolean
          has_stock: boolean
          id: string
          match_by: string | null
          min_full_price: number | null
          min_price: number | null
          nome: string | null
          permalink: string | null
          product_id: string
          qualifies: boolean
          top_offers: Json
          sku: string | null
          total_offers: number
          zip_code: string | null
        }
        Insert: {
          available_quantity?: number | null
          best_is_full?: boolean
          best_item_id?: string | null
          best_price?: number | null
          best_shipping_cost?: number | null
          best_total_price?: number | null
          checked_at?: string
          company_id: string
          ean?: string | null
          error?: string | null
          found?: boolean
          full_offers?: number
          has_full?: boolean
          has_stock?: boolean
          id?: string
          match_by?: string | null
          min_full_price?: number | null
          min_price?: number | null
          nome?: string | null
          permalink?: string | null
          product_id: string
          qualifies: boolean
          top_offers: Json
          sku?: string | null
          total_offers?: number
          zip_code?: string | null
        }
        Update: {
          available_quantity?: number | null
          best_is_full?: boolean
          best_item_id?: string | null
          best_price?: number | null
          best_shipping_cost?: number | null
          best_total_price?: number | null
          checked_at?: string
          company_id?: string
          ean?: string | null
          error?: string | null
          found?: boolean
          full_offers?: number
          has_full?: boolean
          has_stock?: boolean
          id?: string
          match_by?: string | null
          min_full_price?: number | null
          min_price?: number | null
          nome?: string | null
          permalink?: string | null
          product_id?: string
          qualifies?: boolean
          top_offers?: Json
          sku?: string | null
          total_offers?: number
          zip_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ml_product_matches_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: true
            referencedRelation: "bling_products"
            referencedColumns: ["id"]
          },
        ]
      }
      pricing_settings: {
        Row: {
          company_id: string
          created_at: string
          custo_fixo_percent: number
          default_marketplace_id: string | null
          devolucao_percent: number
          embalagem_default: number
          frete_medio_percent: number
          id: string
          price_anchors: Json
          profit_bands: Json
          stock_cap_default: number | null
          taxa_operacional_min_custo: number
          taxa_operacional_valor: number
          transporte_default: number
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          custo_fixo_percent?: number
          default_marketplace_id?: string | null
          devolucao_percent?: number
          embalagem_default?: number
          frete_medio_percent?: number
          id?: string
          price_anchors?: Json
          profit_bands?: Json
          stock_cap_default?: number | null
          taxa_operacional_min_custo?: number
          taxa_operacional_valor?: number
          transporte_default?: number
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          custo_fixo_percent?: number
          default_marketplace_id?: string | null
          devolucao_percent?: number
          embalagem_default?: number
          frete_medio_percent?: number
          id?: string
          price_anchors?: Json
          profit_bands?: Json
          stock_cap_default?: number | null
          taxa_operacional_min_custo?: number
          taxa_operacional_valor?: number
          transporte_default?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pricing_settings_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pricing_settings_default_marketplace_id_fkey"
            columns: ["default_marketplace_id"]
            isOneToOne: false
            referencedRelation: "marketplaces"
            referencedColumns: ["id"]
          },
        ]
      }
      product_cost_overrides: {
        Row: {
          company_id: string
          created_at: string
          embalagem: number | null
          id: string
          product_id: string
          stock_cap: number | null
          taxa_operacional: number | null
          transporte: number | null
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          embalagem?: number | null
          id?: string
          product_id: string
          stock_cap?: number | null
          taxa_operacional?: number | null
          transporte?: number | null
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          embalagem?: number | null
          id?: string
          product_id?: string
          stock_cap?: number | null
          taxa_operacional?: number | null
          transporte?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_cost_overrides_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_cost_overrides_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "bling_products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_sheet_rows: {
        Row: {
          action: string
          applied_at: string | null
          batch_id: string
          bling_id: string | null
          company_id: string
          created_at: string
          diff: Json | null
          error: string | null
          file_name: string | null
          gtin: string | null
          id: string
          match_product_id: string | null
          match_type: string | null
          parsed: Json
          raw: Json
          row_number: number | null
          sku: string | null
        }
        Insert: {
          action?: string
          applied_at?: string | null
          batch_id: string
          bling_id?: string | null
          company_id: string
          created_at?: string
          diff?: Json | null
          error?: string | null
          file_name?: string | null
          gtin?: string | null
          id?: string
          match_product_id?: string | null
          match_type?: string | null
          parsed: Json
          raw: Json
          row_number?: number | null
          sku?: string | null
        }
        Update: {
          action?: string
          applied_at?: string | null
          batch_id?: string
          bling_id?: string | null
          company_id?: string
          created_at?: string
          diff?: Json | null
          error?: string | null
          file_name?: string | null
          gtin?: string | null
          id?: string
          match_product_id?: string | null
          match_type?: string | null
          parsed?: Json
          raw?: Json
          row_number?: number | null
          sku?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_sheet_rows_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_sheet_rows_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email: string
          id: string
          nome: string
          telefone: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string
          id: string
          nome?: string
          telefone?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          nome?: string
          telefone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      transform_sessions: {
        Row: {
          company_id: string
          created_at: string
          finished_at: string | null
          id: string
          name: string
          started_at: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          company_id: string
          created_at?: string
          finished_at?: string | null
          id?: string
          name?: string
          started_at?: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          company_id?: string
          created_at?: string
          finished_at?: string | null
          id?: string
          name?: string
          started_at?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transform_sessions_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      user_permissions: {
        Row: {
          access_expires_at: string | null
          active: boolean
          can_download_sheets: boolean
          can_push_bling: boolean
          can_use_ai: boolean
          created_at: string
          updated_at: string
          user_id: string
        }
        Insert: {
          access_expires_at?: string | null
          active?: boolean
          can_download_sheets?: boolean
          can_push_bling?: boolean
          can_use_ai?: boolean
          created_at?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          access_expires_at?: string | null
          active?: boolean
          can_download_sheets?: boolean
          can_push_bling?: boolean
          can_use_ai?: boolean
          created_at?: string
          updated_at?: string
          user_id?: string
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
      validation_rules: {
        Row: {
          active: boolean
          category: string
          company_id: string | null
          config: Json
          created_at: string
          description: string | null
          id: string
          name: string
          severity: string
          slug: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          category: string
          company_id?: string | null
          config?: Json
          created_at?: string
          description?: string | null
          id?: string
          name: string
          severity?: string
          slug: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          category?: string
          company_id?: string | null
          config?: Json
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          severity?: string
          slug?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "validation_rules_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_import_profiles: {
        Row: { id: string; company_id: string; fornecedor_id: string; name: string; mapping: Json; value_mappings: Json; rules: Json; header_signature: Json; is_default: boolean; created_by: string; created_at: string; updated_at: string }
        Insert: { id?: string; company_id: string; fornecedor_id: string; name: string; mapping?: Json; value_mappings?: Json; rules?: Json; header_signature?: Json; is_default?: boolean; created_by: string; created_at?: string; updated_at?: string }
        Update: { id?: string; company_id?: string; fornecedor_id?: string; name?: string; mapping?: Json; value_mappings?: Json; rules?: Json; header_signature?: Json; is_default?: boolean; created_by?: string; created_at?: string; updated_at?: string }
        Relationships: []
      }
      supplier_import_batches: {
        Row: { id: string; company_id: string; fornecedor_id: string; sku_prefix: string | null; profile_id: string | null; created_by: string; file: Json; mapping_snapshot: Json; value_mappings_snapshot: Json; rules_snapshot: Json; header_signature: Json; status: string; total_rows: number; processed_rows: number; new_count: number; existing_count: number; filtered_count: number; error_count: number; created_at: string; started_at: string; finished_at: string | null }
        Insert: { id?: string; company_id: string; fornecedor_id: string; sku_prefix?: string | null; profile_id?: string | null; created_by: string; file: Json; mapping_snapshot?: Json; value_mappings_snapshot?: Json; rules_snapshot?: Json; header_signature?: Json; status?: string; total_rows?: number; processed_rows?: number; new_count?: number; existing_count?: number; filtered_count?: number; error_count?: number; created_at?: string; started_at?: string; finished_at?: string | null }
        Update: { id?: string; company_id?: string; fornecedor_id?: string; sku_prefix?: string | null; profile_id?: string | null; created_by?: string; file?: Json; mapping_snapshot?: Json; value_mappings_snapshot?: Json; rules_snapshot?: Json; header_signature?: Json; status?: string; total_rows?: number; processed_rows?: number; new_count?: number; existing_count?: number; filtered_count?: number; error_count?: number; created_at?: string; started_at?: string; finished_at?: string | null }
        Relationships: []
      }
      supplier_import_rows: {
        Row: { id: string; batch_id: string; company_id: string; file_name: string | null; row_number: number; sku: string | null; bling_id: string | null; gtin: string | null; raw: Json; parsed: Json; transformation_log: Json; match_type: string | null; match_product_id: string | null; action: string; error: string | null; created_at: string }
        Insert: { id?: string; batch_id: string; company_id: string; file_name?: string | null; row_number: number; sku?: string | null; bling_id?: string | null; gtin?: string | null; raw?: Json; parsed?: Json; transformation_log?: Json; match_type?: string | null; match_product_id?: string | null; action?: string; error?: string | null; created_at?: string }
        Update: { id?: string; batch_id?: string; company_id?: string; file_name?: string | null; row_number?: number; sku?: string | null; bling_id?: string | null; gtin?: string | null; raw?: Json; parsed?: Json; transformation_log?: Json; match_type?: string | null; match_product_id?: string | null; action?: string; error?: string | null; created_at?: string }
        Relationships: []
      }
      worker_leases: {
        Row: {
          acquired_at: string
          expires_at: string
          holder: string
          key: string
          pool: string
        }
        Insert: {
          acquired_at?: string
          expires_at: string
          holder: string
          key: string
          pool: string
        }
        Update: {
          acquired_at?: string
          expires_at?: string
          holder?: string
          key?: string
          pool?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      _apply_price_anchor: {
        Args: { _anchors: Json; _preco: number }
        Returns: number
      }
      _compute_sale_price: {
        Args: {
          _bands: Json
          _comissao_percent: number
          _custo_completo: number
          _devolucao_percent: number
          _taxa_promocao_percent: number
        }
        Returns: number
      }
      acquire_worker_lease: {
        Args: {
          _holder: string
          _key: string
          _max_concurrent?: number
          _pool: string
          _ttl_seconds?: number
        }
        Returns: boolean
      }
      apply_import_batch: {
        Args: {
          _batch_id: string
          _company_id: string
          _default_existing: string
          _default_new: string
          _overrides: Json
        }
        Returns: Json
      }
      audit_price_policy: {
        Args: { _company_id: string; _limit?: number; _product_ids?: string[] }
        Returns: Json
      }
      automation_apply_supplier_status: {
        Args: { _company_id: string; _run_id?: string }
        Returns: Json
      }
      automation_next_run: {
        Args: {
          _day_of_month: number
          _frequency: string
          _from: string
          _hour: number
          _interval_days: number
          _minute: number
          _timezone: string
          _weekday: number
        }
        Returns: string
      }
      automation_run_report: { Args: { _run_id: string }; Returns: Json }
      bi_sales_kpis: {
        Args: { _company_id: string; _from: string; _to: string }
        Returns: Json
      }
      cancel_audit_run_hard: { Args: { _run_id: string }; Returns: boolean }
      cancel_bling_push: { Args: { _company_id: string }; Returns: Json }
      claim_bling_stores_job: {
        Args: { _job_id: string }
        Returns: {
          bling_product_id: string
          company_id: string
          id: string
          integration_id: string
          proxima_pagina: number
          scope: string
        }[]
      }
      claim_due_automation_schedules: {
        Args: { _limit?: number }
        Returns: {
          company_id: string
          id: string
          options: Json
          slug: string
        }[]
      }
      claim_next_push_batch: {
        Args: { _integration_id?: string; _limit?: number }
        Returns: {
          bling_deposit_id: string
          bling_product_id: string
          bling_product_store_id: string
          company_id: string
          id: string
          integration_id: string
          payload: Json
          product_id: string
          tentativas: number
          tipo: string
          valor_novo: number
        }[]
      }
      claim_next_sync_job: {
        Args: { _job_id?: string }
        Returns: {
          claimed: boolean
          company_id: string
          integration_id: string
          job_id: string
          phase: string
          reason: string
        }[]
      }
      classify_import_batch: {
        Args: { _batch_id: string; _company_id: string; _limit?: number }
        Returns: Json
      }
      clear_bling_push_queue: { Args: { _company_id: string }; Returns: Json }
      count_products_without_stores: {
        Args: { _company_id: string }
        Returns: number
      }
      dashboard_stats: { Args: { _company_id: string }; Returns: Json }
      delete_bling_push_errors: { Args: { _company_id: string }; Returns: Json }
      delete_company: { Args: { _company_id: string }; Returns: Json }
      delete_products_batch: {
        Args: { _company_id: string; _limit?: number; _product_ids?: string[] }
        Returns: number
      }
      delete_store_links_batch: {
        Args: { _bling_store_id?: string; _company_id: string; _limit?: number }
        Returns: number
      }
      dre_report: {
        Args: { _company_id: string; _from: string; _to: string }
        Returns: Json
      }
      enqueue_bling_delete: {
        Args: { _company_id: string; _product_ids: string[] }
        Returns: Json
      }
      enqueue_bling_inactivate: {
        Args: { _company_id: string; _product_ids: string[] }
        Returns: Json
      }
      enqueue_bling_link_store: {
        Args: {
          _action: string
          _bling_store_id: string
          _company_id: string
          _product_ids: string[]
        }
        Returns: Json
      }
      enqueue_bling_push: {
        Args: {
          _company_id: string
          _include_stores?: boolean
          _only_changed?: boolean
          _product_ids?: string[]
          _scope?: string
        }
        Returns: Json
      }
      enqueue_bling_sync_tick: {
        Args: { _job_id: string; _secret: string; _url: string }
        Returns: number
      }
      enqueue_http_job: {
        Args: { _body: Json; _secret: string; _url: string }
        Returns: number
      }
      finish_bling_push_created: {
        Args: { _bling_id: string; _item_id: string }
        Returns: undefined
      }
      finish_bling_push_error: {
        Args: {
          _body_safe?: string
          _erro: string
          _item_id: string
          _max_attempts?: number
          _retry_in_seconds?: number
          _status_code?: number
        }
        Returns: undefined
      }
      finish_bling_push_success: {
        Args: { _item_id: string }
        Returns: undefined
      }
      finish_bling_stores_job: {
        Args: { _job_id: string; _last_error?: string; _status: string }
        Returns: undefined
      }
      finish_bling_stores_page: {
        Args: {
          _errors: number
          _found: number
          _inserted: number
          _job_id: string
          _last_error: string
          _matched: number
          _next_page: number
          _page: number
          _total_pages: number
          _unmatched: number
          _updated: number
        }
        Returns: undefined
      }
      get_bling_push_progress: { Args: { _company_id: string }; Returns: Json }
      get_bling_stores_progress: {
        Args: { _company_id: string }
        Returns: Json
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      list_audit_issue_types_fast: {
        Args: { _company_id: string }
        Returns: Json
      }
      list_product_ids_fast:
        | {
            Args: {
              _audit_rule_slug?: string
              _audit_run_id?: string
              _audit_status?: string
              _company_id: string
              _detail_filter?: string
              _search?: string
              _situacao?: string
              _tipo?: string
            }
            Returns: Json
          }
        | {
            Args: {
              _audit_rule_slug?: string
              _audit_run_id?: string
              _audit_status?: string
              _company_id: string
              _detail_filter?: string
              _search?: string
              _situacao?: string
              _stores_filter?: string
              _tipo?: string
            }
            Returns: Json
          }
      list_products_fast:
        | {
            Args: {
              _audit_rule_slug?: string
              _audit_run_id?: string
              _audit_status?: string
              _company_id: string
              _detail_filter?: string
              _page?: number
              _page_size?: number
              _search?: string
              _situacao?: string
              _tipo?: string
            }
            Returns: Json
          }
        | {
            Args: {
              _audit_rule_slug?: string
              _audit_run_id?: string
              _audit_status?: string
              _company_id: string
              _detail_filter?: string
              _page?: number
              _page_size?: number
              _search?: string
              _situacao?: string
              _stores_filter?: string
              _tipo?: string
            }
            Returns: Json
          }
      list_products_without_stores:
        | {
            Args: { _company_id: string; _limit?: number; _offset?: number }
            Returns: {
              bling_product_id: string
            }[]
          }
        | {
            Args: {
              _after?: string
              _company_id: string
              _limit?: number
              _offset?: number
            }
            Returns: {
              bling_product_id: string
            }[]
          }
      low_margin_products: {
        Args: { _company_id: string; _limit?: number; _threshold?: number }
        Returns: Json
      }
      norm_cmp: { Args: { _v: string }; Returns: string }
      pause_bling_push: { Args: { _company_id: string }; Returns: Json }
      pricing_policy_status: { Args: { _company_id: string }; Returns: Json }
      prune_old_operational_data: { Args: never; Returns: undefined }
      reclaim_stuck_workers: { Args: { _minutes?: number }; Returns: Json }
      reclaim_stuck_workers_throttled: {
        Args: { _every_seconds?: number; _minutes?: number }
        Returns: Json
      }
      release_worker_lease: {
        Args: { _holder: string; _key: string }
        Returns: undefined
      }
      request_cancel_bling_stores_sync: {
        Args: { _company_id: string; _job_id?: string }
        Returns: Json
      }
      resume_bling_push: { Args: { _company_id: string }; Returns: Json }
      retry_bling_push_errors: { Args: { _company_id: string }; Returns: Json }
      run_audit_extra_rules: { Args: { _run_id: string }; Returns: Json }
      run_audit_sql: { Args: { _run_id: string }; Returns: Json }
      set_bling_channel_intermediador: {
        Args: {
          _bling_store_id: string
          _cnpj: string
          _integration_id: string
          _nome: string
        }
        Returns: undefined
      }
      set_bling_default_deposito: {
        Args: {
          _company_id: string
          _deposito_id: string
          _integration_id: string
        }
        Returns: undefined
      }
      set_bling_store_marketplace: {
        Args: {
          _bling_store_id: string
          _company_id: string
          _is_default: boolean
          _marketplace_id: string
        }
        Returns: undefined
      }
      set_bling_stores_job_cursor: {
        Args: { _cursor: string; _job_id: string }
        Returns: undefined
      }
      set_bling_stores_job_total: {
        Args: { _job_id: string; _total: number }
        Returns: undefined
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      start_bling_stores_sync: {
        Args: {
          _bling_product_id?: string
          _company_id: string
          _scope?: string
        }
        Returns: Json
      }
      strip_html_text: { Args: { s: string }; Returns: string }
      transform_fill_desc_complementar:
        | { Args: { _company_id: string }; Returns: Json }
        | {
            Args: { _company_id: string; _product_ids?: string[] }
            Returns: Json
          }
      transform_fill_dimensions_from_supplier: {
        Args: { _company_id: string; _product_ids?: string[] }
        Returns: Json
      }
      transform_fill_ean_from_supplier: {
        Args: { _company_id: string; _product_ids?: string[] }
        Returns: Json
      }
      transform_fill_garantia_anatel: {
        Args: { _company_id: string; _product_ids?: string[] }
        Returns: Json
      }
      transform_remove_garantia_anatel:
        | { Args: { _company_id: string }; Returns: Json }
        | {
            Args: { _company_id: string; _product_ids?: string[] }
            Returns: Json
          }
      transform_session_product_ids: {
        Args: { _session_id: string }
        Returns: Json
      }
      transform_session_products: {
        Args: { _session_id: string }
        Returns: Json
      }
      transform_set_crossdocking: {
        Args: { _company_id: string; _dias?: number; _product_ids?: string[] }
        Returns: Json
      }
      transform_strip_html:
        | { Args: { _company_id: string }; Returns: Json }
        | {
            Args: { _company_id: string; _product_ids?: string[] }
            Returns: Json
          }
      transform_sync_supplier_stock_price: {
        Args: { _company_id: string; _product_ids?: string[] }
        Returns: Json
      }
      transform_trim_images: {
        Args: { _company_id: string; _max?: number; _product_ids?: string[] }
        Returns: Json
      }
      transform_update_price_stock: {
        Args: {
          _company_id: string
          _include_stores?: boolean
          _product_ids?: string[]
          _run_id?: string
          _only_stock?: boolean
        }
        Returns: Json
      }
      transform_zero_stock: {
        Args: { _company_id: string; _product_ids?: string[] }
        Returns: Json
      }
      upsert_bling_channel: {
        Args: { _company_id: string; _integration_id: string; _row: Json }
        Returns: string
      }
      upsert_bling_product_store: {
        Args: {
          _company_id: string
          _integration_id: string
          _row: Json
          _run_id: string
        }
        Returns: string
      }
      upsert_bling_product_stores_batch: {
        Args: {
          _company_id: string
          _integration_id: string
          _rows: Json
          _run_id: string
        }
        Returns: Json
      }
    }
    Enums: {
      app_role: "admin" | "user"
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
      app_role: ["admin", "user"],
    },
  },
} as const
