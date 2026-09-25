export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      audit_log: {
        Row: {
          action: string
          actor_email: string | null
          actor_id: string | null
          actor_role: Database["public"]["Enums"]["user_role"] | null
          changes: Json | null
          entity: string
          entity_id: string | null
          id: number
          occurred_at: string
          source: string
        }
        Insert: {
          action: string
          actor_email?: string | null
          actor_id?: string | null
          actor_role?: Database["public"]["Enums"]["user_role"] | null
          changes?: Json | null
          entity: string
          entity_id?: string | null
          id?: never
          occurred_at?: string
          source: string
        }
        Update: {
          action?: string
          actor_email?: string | null
          actor_id?: string | null
          actor_role?: Database["public"]["Enums"]["user_role"] | null
          changes?: Json | null
          entity?: string
          entity_id?: string | null
          id?: never
          occurred_at?: string
          source?: string
        }
        Relationships: []
      }
      business_days: {
        Row: {
          close_kind: string | null
          closed_at: string | null
          closed_by: string | null
          id: string
          needs_review: boolean
          notes: string | null
          opened_at: string
          opened_by: string
          reviewed_at: string | null
          reviewed_by: string | null
        }
        Insert: {
          close_kind?: string | null
          closed_at?: string | null
          closed_by?: string | null
          id?: string
          needs_review?: boolean
          notes?: string | null
          opened_at?: string
          opened_by: string
          reviewed_at?: string | null
          reviewed_by?: string | null
        }
        Update: {
          close_kind?: string | null
          closed_at?: string | null
          closed_by?: string | null
          id?: string
          needs_review?: boolean
          notes?: string | null
          opened_at?: string
          opened_by?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "business_days_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_days_opened_by_fkey"
            columns: ["opened_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_days_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_movements: {
        Row: {
          amount: number
          created_at: string
          created_by: string
          id: string
          kind: string
          reason: string
          session_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          created_by: string
          id?: string
          kind: string
          reason: string
          session_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string
          id?: string
          kind?: string
          reason?: string
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cash_movements_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_movements_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "cash_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_registers: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
        }
        Relationships: []
      }
      cash_session_users: {
        Row: {
          session_id: string
          user_id: string
        }
        Insert: {
          session_id: string
          user_id: string
        }
        Update: {
          session_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cash_session_users_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "cash_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_session_users_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_sessions: {
        Row: {
          business_day_id: string
          closed_at: string | null
          closed_by: string | null
          counted_cash: number | null
          difference: number | null
          expected_cash: number | null
          id: string
          needs_review: boolean
          notes: string | null
          opened_at: string
          opened_by: string
          opening_float: number
          register_id: string
          status: string
        }
        Insert: {
          business_day_id: string
          closed_at?: string | null
          closed_by?: string | null
          counted_cash?: number | null
          difference?: number | null
          expected_cash?: number | null
          id?: string
          needs_review?: boolean
          notes?: string | null
          opened_at?: string
          opened_by: string
          opening_float: number
          register_id: string
          status?: string
        }
        Update: {
          business_day_id?: string
          closed_at?: string | null
          closed_by?: string | null
          counted_cash?: number | null
          difference?: number | null
          expected_cash?: number | null
          id?: string
          needs_review?: boolean
          notes?: string | null
          opened_at?: string
          opened_by?: string
          opening_float?: number
          register_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "cash_sessions_business_day_id_fkey"
            columns: ["business_day_id"]
            isOneToOne: false
            referencedRelation: "business_days"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_sessions_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_sessions_opened_by_fkey"
            columns: ["opened_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_sessions_register_id_fkey"
            columns: ["register_id"]
            isOneToOne: false
            referencedRelation: "cash_registers"
            referencedColumns: ["id"]
          },
        ]
      }
      categories: {
        Row: {
          created_at: string
          description: string | null
          id: string
          name: string
          parent_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          name: string
          parent_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          parent_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "categories_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          address: string | null
          created_at: string
          deleted_at: string | null
          email: string | null
          id: string
          is_active: boolean
          loyalty_points: number
          name: string
          phone: string | null
          total_spent: number
          updated_at: string
        }
        Insert: {
          address?: string | null
          created_at?: string
          deleted_at?: string | null
          email?: string | null
          id?: string
          is_active?: boolean
          loyalty_points?: number
          name: string
          phone?: string | null
          total_spent?: number
          updated_at?: string
        }
        Update: {
          address?: string | null
          created_at?: string
          deleted_at?: string | null
          email?: string | null
          id?: string
          is_active?: boolean
          loyalty_points?: number
          name?: string
          phone?: string | null
          total_spent?: number
          updated_at?: string
        }
        Relationships: []
      }
      expense_categories: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      expenses: {
        Row: {
          amount: number
          business_day_id: string | null
          cash_session_id: string | null
          category_id: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          description: string
          id: string
          occurred_at: string
          payment_method: Database["public"]["Enums"]["payment_method"]
          supplier_id: string | null
          updated_at: string
          void_reason: string | null
          voided_after_close: boolean
        }
        Insert: {
          amount: number
          business_day_id?: string | null
          cash_session_id?: string | null
          category_id: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description: string
          id?: string
          occurred_at?: string
          payment_method: Database["public"]["Enums"]["payment_method"]
          supplier_id?: string | null
          updated_at?: string
          void_reason?: string | null
          voided_after_close?: boolean
        }
        Update: {
          amount?: number
          business_day_id?: string | null
          cash_session_id?: string | null
          category_id?: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description?: string
          id?: string
          occurred_at?: string
          payment_method?: Database["public"]["Enums"]["payment_method"]
          supplier_id?: string | null
          updated_at?: string
          void_reason?: string | null
          voided_after_close?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "expenses_business_day_id_fkey"
            columns: ["business_day_id"]
            isOneToOne: false
            referencedRelation: "business_days"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_cash_session_id_fkey"
            columns: ["cash_session_id"]
            isOneToOne: false
            referencedRelation: "cash_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "expense_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      idempotency_keys: {
        Row: {
          action: string
          created_at: string
          key: string
          request_hash: string
          result: Json | null
          user_id: string
        }
        Insert: {
          action: string
          created_at?: string
          key: string
          request_hash: string
          result?: Json | null
          user_id: string
        }
        Update: {
          action?: string
          created_at?: string
          key?: string
          request_hash?: string
          result?: Json | null
          user_id?: string
        }
        Relationships: []
      }
      inventory: {
        Row: {
          created_at: string
          id: string
          last_restocked_at: string | null
          location: string | null
          low_stock_threshold: number
          product_id: string
          quantity: number
          updated_at: string
          variant_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          last_restocked_at?: string | null
          location?: string | null
          low_stock_threshold?: number
          product_id: string
          quantity?: number
          updated_at?: string
          variant_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          last_restocked_at?: string | null
          location?: string | null
          low_stock_threshold?: number
          product_id?: string
          quantity?: number
          updated_at?: string
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_transactions: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          inventory_id: string
          notes: string | null
          quantity: number
          reference_id: string | null
          supplier_id: string | null
          transaction_type: string
          unit_cost: number | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          inventory_id: string
          notes?: string | null
          quantity: number
          reference_id?: string | null
          supplier_id?: string | null
          transaction_type: string
          unit_cost?: number | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          inventory_id?: string
          notes?: string | null
          quantity?: number
          reference_id?: string | null
          supplier_id?: string | null
          transaction_type?: string
          unit_cost?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_transactions_inventory_id_fkey"
            columns: ["inventory_id"]
            isOneToOne: false
            referencedRelation: "inventory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_transactions_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_outbox: {
        Row: {
          attempts: number
          claimed_at: string | null
          created_at: string
          id: number
          kind: string
          last_error: string | null
          payload: Json
          processed_at: string | null
        }
        Insert: {
          attempts?: number
          claimed_at?: string | null
          created_at?: string
          id?: never
          kind: string
          last_error?: string | null
          payload?: Json
          processed_at?: string | null
        }
        Update: {
          attempts?: number
          claimed_at?: string | null
          created_at?: string
          id?: never
          kind?: string
          last_error?: string | null
          payload?: Json
          processed_at?: string | null
        }
        Relationships: []
      }
      order_items: {
        Row: {
          created_at: string
          discount: number
          id: string
          order_id: string
          product_id: string
          promotion_id: string | null
          quantity: number
          stock_taken: number | null
          tax: number
          tax_rate: number | null
          total: number
          unit_cost: number | null
          unit_price: number
          variant_id: string | null
        }
        Insert: {
          created_at?: string
          discount?: number
          id?: string
          order_id: string
          product_id: string
          promotion_id?: string | null
          quantity: number
          stock_taken?: number | null
          tax?: number
          tax_rate?: number | null
          total: number
          unit_cost?: number | null
          unit_price: number
          variant_id?: string | null
        }
        Update: {
          created_at?: string
          discount?: number
          id?: string
          order_id?: string
          product_id?: string
          promotion_id?: string | null
          quantity?: number
          stock_taken?: number | null
          tax?: number
          tax_rate?: number | null
          total?: number
          unit_cost?: number | null
          unit_price?: number
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_promotion_id_fkey"
            columns: ["promotion_id"]
            isOneToOne: false
            referencedRelation: "promotions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          business_day_id: string | null
          cash_session_id: string | null
          client_ref: string | null
          created_at: string
          created_by: string | null
          customer_id: string | null
          debtor_name: string | null
          discount: number
          due_date: string | null
          id: string
          notes: string | null
          occurred_at: string | null
          order_number: string
          refund_after_close: boolean
          refund_cash_session_id: string | null
          refund_reason: string | null
          refunded_at: string | null
          refunded_by: string | null
          reminder_enabled: boolean
          reminder_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          settled_at: string | null
          source: string
          status: Database["public"]["Enums"]["order_status"]
          subtotal: number
          sync_issues: Json | null
          tab_id: string | null
          tax: number
          total: number
          updated_at: string
          write_off_reason: string | null
          written_off_at: string | null
          written_off_by: string | null
        }
        Insert: {
          business_day_id?: string | null
          cash_session_id?: string | null
          client_ref?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          debtor_name?: string | null
          discount?: number
          due_date?: string | null
          id?: string
          notes?: string | null
          occurred_at?: string | null
          order_number: string
          refund_after_close?: boolean
          refund_cash_session_id?: string | null
          refund_reason?: string | null
          refunded_at?: string | null
          refunded_by?: string | null
          reminder_enabled?: boolean
          reminder_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          settled_at?: string | null
          source?: string
          status?: Database["public"]["Enums"]["order_status"]
          subtotal?: number
          sync_issues?: Json | null
          tab_id?: string | null
          tax?: number
          total?: number
          updated_at?: string
          write_off_reason?: string | null
          written_off_at?: string | null
          written_off_by?: string | null
        }
        Update: {
          business_day_id?: string | null
          cash_session_id?: string | null
          client_ref?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          debtor_name?: string | null
          discount?: number
          due_date?: string | null
          id?: string
          notes?: string | null
          occurred_at?: string | null
          order_number?: string
          refund_after_close?: boolean
          refund_cash_session_id?: string | null
          refund_reason?: string | null
          refunded_at?: string | null
          refunded_by?: string | null
          reminder_enabled?: boolean
          reminder_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          settled_at?: string | null
          source?: string
          status?: Database["public"]["Enums"]["order_status"]
          subtotal?: number
          sync_issues?: Json | null
          tab_id?: string | null
          tax?: number
          total?: number
          updated_at?: string
          write_off_reason?: string | null
          written_off_at?: string | null
          written_off_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_business_day_id_fkey"
            columns: ["business_day_id"]
            isOneToOne: false
            referencedRelation: "business_days"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_cash_session_id_fkey"
            columns: ["cash_session_id"]
            isOneToOne: false
            referencedRelation: "cash_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_refund_cash_session_id_fkey"
            columns: ["refund_cash_session_id"]
            isOneToOne: false
            referencedRelation: "cash_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_tab_id_fkey"
            columns: ["tab_id"]
            isOneToOne: false
            referencedRelation: "tabs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_written_off_by_fkey"
            columns: ["written_off_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount: number
          business_day_id: string | null
          cash_session_id: string | null
          created_at: string
          created_by: string | null
          id: string
          notes: string | null
          order_id: string
          payment_method: Database["public"]["Enums"]["payment_method"]
          reference_number: string | null
        }
        Insert: {
          amount: number
          business_day_id?: string | null
          cash_session_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          order_id: string
          payment_method: Database["public"]["Enums"]["payment_method"]
          reference_number?: string | null
        }
        Update: {
          amount?: number
          business_day_id?: string | null
          cash_session_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          order_id?: string
          payment_method?: Database["public"]["Enums"]["payment_method"]
          reference_number?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payments_business_day_id_fkey"
            columns: ["business_day_id"]
            isOneToOne: false
            referencedRelation: "business_days"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_cash_session_id_fkey"
            columns: ["cash_session_id"]
            isOneToOne: false
            referencedRelation: "cash_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      product_variants: {
        Row: {
          barcode: string | null
          cost_price: number | null
          created_at: string
          id: string
          name: string
          product_id: string
          selling_price: number | null
          sku: string
          variant_type: string
        }
        Insert: {
          barcode?: string | null
          cost_price?: number | null
          created_at?: string
          id?: string
          name: string
          product_id: string
          selling_price?: number | null
          sku: string
          variant_type: string
        }
        Update: {
          barcode?: string | null
          cost_price?: number | null
          created_at?: string
          id?: string
          name?: string
          product_id?: string
          selling_price?: number | null
          sku?: string
          variant_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          barcode: string | null
          category_id: string | null
          cost_price: number
          created_at: string
          deleted_at: string | null
          description: string | null
          id: string
          image_key: string | null
          image_url: string | null
          is_active: boolean
          name: string
          selling_price: number
          sku: string
          tax_rate: number
          updated_at: string
        }
        Insert: {
          barcode?: string | null
          category_id?: string | null
          cost_price?: number
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          id?: string
          image_key?: string | null
          image_url?: string | null
          is_active?: boolean
          name: string
          selling_price?: number
          sku: string
          tax_rate?: number
          updated_at?: string
        }
        Update: {
          barcode?: string | null
          category_id?: string | null
          cost_price?: number
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          id?: string
          image_key?: string | null
          image_url?: string | null
          is_active?: boolean
          name?: string
          selling_price?: number
          sku?: string
          tax_rate?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string
          full_name: string | null
          id: string
          is_active: boolean
          locale: string
          notify_email: boolean
          notify_push: boolean
          phone: string | null
          role: Database["public"]["Enums"]["user_role"]
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email: string
          full_name?: string | null
          id: string
          is_active?: boolean
          locale?: string
          notify_email?: boolean
          notify_push?: boolean
          phone?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string
          full_name?: string | null
          id?: string
          is_active?: boolean
          locale?: string
          notify_email?: boolean
          notify_push?: boolean
          phone?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Relationships: []
      }
      promotion_items: {
        Row: {
          created_at: string
          id: string
          product_id: string
          promotion_id: string
          quantity: number
        }
        Insert: {
          created_at?: string
          id?: string
          product_id: string
          promotion_id: string
          quantity: number
        }
        Update: {
          created_at?: string
          id?: string
          product_id?: string
          promotion_id?: string
          quantity?: number
        }
        Relationships: [
          {
            foreignKeyName: "promotion_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promotion_items_promotion_id_fkey"
            columns: ["promotion_id"]
            isOneToOne: false
            referencedRelation: "promotions"
            referencedColumns: ["id"]
          },
        ]
      }
      promotions: {
        Row: {
          created_at: string
          deleted_at: string | null
          id: string
          is_active: boolean
          name: string
          package_price: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          is_active?: boolean
          name: string
          package_price: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          is_active?: boolean
          name?: string
          package_price?: number
          updated_at?: string
        }
        Relationships: []
      }
      purchase_order_items: {
        Row: {
          created_at: string
          id: string
          product_id: string
          purchase_order_id: string
          quantity: number
          total: number | null
          unit_price: number
          variant_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          product_id: string
          purchase_order_id: string
          quantity: number
          total?: number | null
          unit_price: number
          variant_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          product_id?: string
          purchase_order_id?: string
          quantity?: number
          total?: number | null
          unit_price?: number
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "purchase_order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_items_purchase_order_id_fkey"
            columns: ["purchase_order_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_items_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_orders: {
        Row: {
          business_day_id: string | null
          cash_session_id: string | null
          created_at: string
          id: string
          invoice_number: string | null
          notes: string | null
          ordered_at: string | null
          ordered_by: string | null
          po_number: string
          received_at: string | null
          received_by: string | null
          status: Database["public"]["Enums"]["po_status"] | null
          supplier_id: string | null
          total_amount: number | null
          updated_at: string
          voided_after_close: boolean
        }
        Insert: {
          business_day_id?: string | null
          cash_session_id?: string | null
          created_at?: string
          id?: string
          invoice_number?: string | null
          notes?: string | null
          ordered_at?: string | null
          ordered_by?: string | null
          po_number: string
          received_at?: string | null
          received_by?: string | null
          status?: Database["public"]["Enums"]["po_status"] | null
          supplier_id?: string | null
          total_amount?: number | null
          updated_at?: string
          voided_after_close?: boolean
        }
        Update: {
          business_day_id?: string | null
          cash_session_id?: string | null
          created_at?: string
          id?: string
          invoice_number?: string | null
          notes?: string | null
          ordered_at?: string | null
          ordered_by?: string | null
          po_number?: string
          received_at?: string | null
          received_by?: string | null
          status?: Database["public"]["Enums"]["po_status"] | null
          supplier_id?: string | null
          total_amount?: number | null
          updated_at?: string
          voided_after_close?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "purchase_orders_business_day_id_fkey"
            columns: ["business_day_id"]
            isOneToOne: false
            referencedRelation: "business_days"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_cash_session_id_fkey"
            columns: ["cash_session_id"]
            isOneToOne: false
            referencedRelation: "cash_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          id: string
          p256dh: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          id?: string
          p256dh: string
          user_agent?: string | null
          user_id?: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          id?: string
          p256dh?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_subscriptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      settings: {
        Row: {
          created_at: string
          id: string
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          created_at?: string
          id?: string
          key: string
          updated_at?: string
          value: Json
        }
        Update: {
          created_at?: string
          id?: string
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      stock_alert_state: {
        Row: {
          inventory_id: string
          is_low: boolean
          last_notified_at: string | null
        }
        Insert: {
          inventory_id: string
          is_low?: boolean
          last_notified_at?: string | null
        }
        Update: {
          inventory_id?: string
          is_low?: boolean
          last_notified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_alert_state_inventory_id_fkey"
            columns: ["inventory_id"]
            isOneToOne: true
            referencedRelation: "inventory"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers: {
        Row: {
          address: string | null
          contact_person: string | null
          created_at: string
          deleted_at: string | null
          email: string | null
          id: string
          is_active: boolean
          name: string
          notes: string | null
          phone: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          contact_person?: string | null
          created_at?: string
          deleted_at?: string | null
          email?: string | null
          id?: string
          is_active?: boolean
          name: string
          notes?: string | null
          phone?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          contact_person?: string | null
          created_at?: string
          deleted_at?: string | null
          email?: string | null
          id?: string
          is_active?: boolean
          name?: string
          notes?: string | null
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      tab_items: {
        Row: {
          added_by: string | null
          created_at: string
          discount: number
          id: string
          product_id: string
          promotion_id: string | null
          quantity: number
          tab_id: string
          tax_rate: number
          unit_price: number
          updated_at: string
          variant_id: string | null
        }
        Insert: {
          added_by?: string | null
          created_at?: string
          discount?: number
          id?: string
          product_id: string
          promotion_id?: string | null
          quantity: number
          tab_id: string
          tax_rate: number
          unit_price: number
          updated_at?: string
          variant_id?: string | null
        }
        Update: {
          added_by?: string | null
          created_at?: string
          discount?: number
          id?: string
          product_id?: string
          promotion_id?: string | null
          quantity?: number
          tab_id?: string
          tax_rate?: number
          unit_price?: number
          updated_at?: string
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tab_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tab_items_promotion_id_fkey"
            columns: ["promotion_id"]
            isOneToOne: false
            referencedRelation: "promotions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tab_items_tab_id_fkey"
            columns: ["tab_id"]
            isOneToOne: false
            referencedRelation: "tabs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tab_items_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      tab_members: {
        Row: {
          created_at: string
          customer_id: string | null
          display_name: string
          id: string
          tab_id: string
        }
        Insert: {
          created_at?: string
          customer_id?: string | null
          display_name: string
          id?: string
          tab_id: string
        }
        Update: {
          created_at?: string
          customer_id?: string | null
          display_name?: string
          id?: string
          tab_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tab_members_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tab_members_tab_id_fkey"
            columns: ["tab_id"]
            isOneToOne: false
            referencedRelation: "tabs"
            referencedColumns: ["id"]
          },
        ]
      }
      tab_payments: {
        Row: {
          amount: number
          cash_session_id: string | null
          created_at: string
          created_by: string | null
          id: string
          member_id: string | null
          payment_method: Database["public"]["Enums"]["payment_method"]
          tab_id: string
        }
        Insert: {
          amount: number
          cash_session_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          member_id?: string | null
          payment_method: Database["public"]["Enums"]["payment_method"]
          tab_id: string
        }
        Update: {
          amount?: number
          cash_session_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          member_id?: string | null
          payment_method?: Database["public"]["Enums"]["payment_method"]
          tab_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tab_payments_cash_session_id_fkey"
            columns: ["cash_session_id"]
            isOneToOne: false
            referencedRelation: "cash_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tab_payments_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "tab_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tab_payments_tab_id_fkey"
            columns: ["tab_id"]
            isOneToOne: false
            referencedRelation: "tabs"
            referencedColumns: ["id"]
          },
        ]
      }
      tabs: {
        Row: {
          closed_at: string | null
          closed_by: string | null
          customer_id: string | null
          discount: number
          id: string
          label: string
          opened_at: string
          opened_by: string | null
          order_id: string | null
          status: Database["public"]["Enums"]["tab_status"]
          tab_number: string
          updated_at: string
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        Insert: {
          closed_at?: string | null
          closed_by?: string | null
          customer_id?: string | null
          discount?: number
          id?: string
          label: string
          opened_at?: string
          opened_by?: string | null
          order_id?: string | null
          status?: Database["public"]["Enums"]["tab_status"]
          tab_number: string
          updated_at?: string
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Update: {
          closed_at?: string | null
          closed_by?: string | null
          customer_id?: string | null
          discount?: number
          id?: string
          label?: string
          opened_at?: string
          opened_by?: string | null
          order_id?: string | null
          status?: Database["public"]["Enums"]["tab_status"]
          tab_number?: string
          updated_at?: string
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tabs_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tabs_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      _auto_close_stale_business_days: { Args: never; Returns: undefined }
      _claim_outbox: {
        Args: { p_limit: number }
        Returns: {
          attempts: number
          claimed_at: string | null
          created_at: string
          id: number
          kind: string
          last_error: string | null
          payload: Json
          processed_at: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "notification_outbox"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      _close_tab: { Args: { p_tab_id: string }; Returns: string }
      _create_order_from_tab: {
        Args: {
          p_debtor_name?: string
          p_status: Database["public"]["Enums"]["order_status"]
          p_tab_id: string
        }
        Returns: string
      }
      _current_assignment: {
        Args: { p_at: string; p_user: string }
        Returns: {
          business_day_id: string
          cash_session_id: string
        }[]
      }
      _enqueue_due_receivables: { Args: never; Returns: undefined }
      _mark_outbox_delivery: {
        Args: { p_ids: number[]; p_recipient: string }
        Returns: undefined
      }
      _purge_outbox: { Args: never; Returns: undefined }
      _session_cash: { Args: { p_session_id: string }; Returns: Json }
      _tab_totals: {
        Args: { p_tab_id: string }
        Returns: {
          balance: number
          discount: number
          paid: number
          subtotal: number
          tax: number
          total: number
        }[]
      }
      add_cash_movement: {
        Args: {
          p_amount: number
          p_kind: string
          p_reason: string
          p_session_id: string
        }
        Returns: string
      }
      adjust_business_day: {
        Args: {
          p_closed_at: string
          p_id: string
          p_notes?: string
          p_opened_at: string
        }
        Returns: undefined
      }
      adjust_inventory: {
        Args: { p_delta: number; p_inventory_id: string; p_reason: string }
        Returns: number
      }
      balance: {
        Args: { t: Database["public"]["Tables"]["tabs"]["Row"] }
        Returns: number
      }
      business_day_report: {
        Args: { p_business_day_id: string }
        Returns: Json
      }
      cash_session_summary: { Args: { p_session_id: string }; Returns: Json }
      close_business_day: {
        Args: { p_id: string; p_notes?: string }
        Returns: undefined
      }
      close_cash_session: {
        Args: { p_counted_cash: number; p_notes?: string; p_session_id: string }
        Returns: Json
      }
      create_expense: {
        Args: {
          p_amount: number
          p_cash_session_id: string
          p_category_id: string
          p_description: string
          p_occurred_at: string
          p_payment_method: Database["public"]["Enums"]["payment_method"]
          p_supplier_id: string
        }
        Returns: string
      }
      create_sale: {
        Args: {
          p_customer_id: string
          p_discount?: number
          p_expected_total?: number
          p_idempotency_key?: string
          p_items: Json
          p_occurred_at?: string
          p_payment_method?: Database["public"]["Enums"]["payment_method"]
          p_payments?: Json
        }
        Returns: string
      }
      currency_decimals: { Args: { p_currency: string }; Returns: number }
      current_app_role: {
        Args: never
        Returns: Database["public"]["Enums"]["user_role"]
      }
      dashboard_summary: { Args: { p_tz?: string }; Returns: Json }
      defer_tab: {
        Args: {
          p_customer_id?: string
          p_debtor_name?: string
          p_due_date: string
          p_idempotency_key?: string
          p_note: string
          p_payments?: Json
          p_reminder: boolean
          p_tab_id: string
        }
        Returns: string
      }
      has_min_role: {
        Args: { p_minimum: Database["public"]["Enums"]["user_role"] }
        Returns: boolean
      }
      list_receivables: {
        Args: {
          p_customer_id: string
          p_limit?: number
          p_q?: string
          p_status: string
        }
        Returns: Json
      }
      log_auth_event: {
        Args: { p_action: string; p_metadata?: Json }
        Returns: undefined
      }
      log_outbox_discard: {
        Args: {
          p_client_ref: string
          p_expected_total: number
          p_owner_user_id: string
          p_payment_method: Database["public"]["Enums"]["payment_method"]
          p_provisional_number: string
          p_reason: string
        }
        Returns: undefined
      }
      mark_order_reviewed: { Args: { p_order_id: string }; Returns: undefined }
      money_scale: { Args: never; Returns: number }
      open_business_day: { Args: { p_notes?: string }; Returns: string }
      open_cash_session: {
        Args: {
          p_opening_float: number
          p_register_id: string
          p_user_ids: string[]
        }
        Returns: string
      }
      open_tab: {
        Args: { p_customer_id: string; p_label: string; p_members: string[] }
        Returns: string
      }
      pay_receivable: {
        Args: {
          p_idempotency_key?: string
          p_order_id: string
          p_payments: Json
        }
        Returns: Json
      }
      receive_purchase: {
        Args: {
          p_cash_session_id: string
          p_idempotency_key?: string
          p_invoice: string
          p_items: Json
          p_notes: string
          p_supplier_id: string
        }
        Returns: string
      }
      refresh_business_days: { Args: never; Returns: undefined }
      refresh_customer_totals: {
        Args: { p_customer_id: string }
        Returns: undefined
      }
      refund_order: {
        Args: { p_order_id: string; p_reason: string }
        Returns: undefined
      }
      register_push_subscription: {
        Args: {
          p_auth: string
          p_endpoint: string
          p_p256dh: string
          p_user_agent?: string
        }
        Returns: {
          auth: string
          created_at: string
          endpoint: string
          id: string
          p256dh: string
          user_agent: string | null
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "push_subscriptions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      sales_report: {
        Args: { p_from: string; p_to: string; p_tz?: string }
        Returns: Json
      }
      set_low_stock_threshold: {
        Args: { p_inventory_id: string; p_threshold: number }
        Returns: undefined
      }
      set_notification_prefs: {
        Args: { p_email: boolean; p_push: boolean }
        Returns: undefined
      }
      supplier_purchase_history: {
        Args: { p_from: string; p_supplier_id: string; p_to: string }
        Returns: Json
      }
      tab_add_items: {
        Args: { p_items: Json; p_tab_id: string }
        Returns: undefined
      }
      tab_add_members: {
        Args: { p_names: string[]; p_tab_id: string }
        Returns: undefined
      }
      tab_pay: {
        Args: {
          p_amount: number
          p_idempotency_key?: string
          p_member_id: string
          p_method: Database["public"]["Enums"]["payment_method"]
          p_tab_id: string
        }
        Returns: undefined
      }
      tab_pay_split: {
        Args: {
          p_idempotency_key?: string
          p_member_id: string
          p_payments: Json
          p_tab_id: string
        }
        Returns: undefined
      }
      tab_remove_item: {
        Args: {
          p_item_id: string
          p_quantity: number
          p_reason: string
          p_tab_id: string
        }
        Returns: undefined
      }
      tab_set_discount: {
        Args: { p_discount: number; p_tab_id: string }
        Returns: undefined
      }
      tab_summary: {
        Args: { p_tab_id: string }
        Returns: {
          balance: number
          discount: number
          paid: number
          subtotal: number
          tax: number
          total: number
        }[]
      }
      top_selling_products: {
        Args: { p_days?: number; p_limit?: number }
        Returns: {
          category_name: string
          name: string
          product_id: string
          quantity: number
          selling_price: number
          stock: number
        }[]
      }
      update_receivable: {
        Args: {
          p_due_date: string
          p_note: string
          p_order_id: string
          p_reminder: boolean
        }
        Returns: undefined
      }
      void_expense: {
        Args: { p_id: string; p_reason: string }
        Returns: undefined
      }
      void_purchase: {
        Args: { p_id: string; p_reason: string }
        Returns: undefined
      }
      void_tab: {
        Args: { p_reason: string; p_tab_id: string }
        Returns: undefined
      }
      write_off_receivable: {
        Args: { p_order_id: string; p_reason: string }
        Returns: undefined
      }
    }
    Enums: {
      order_status:
        | "draft"
        | "pending"
        | "completed"
        | "refunded"
        | "written_off"
      payment_method: "cash" | "card" | "ewallet"
      po_status: "draft" | "pending" | "received" | "cancelled"
      tab_status: "open" | "closed" | "voided"
      user_role: "admin" | "manager" | "cashier"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      order_status: [
        "draft",
        "pending",
        "completed",
        "refunded",
        "written_off",
      ],
      payment_method: ["cash", "card", "ewallet"],
      po_status: ["draft", "pending", "received", "cancelled"],
      tab_status: ["open", "closed", "voided"],
      user_role: ["admin", "manager", "cashier"],
    },
  },
} as const

