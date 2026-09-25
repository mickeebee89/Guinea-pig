// GENERATED FILE — DO NOT EDIT BY HAND.
//
// Written by scripts/gen-supabase-types.mjs from the live database.
// TYPES_STAMP: 0061
//
// Regenerate whenever a migration is applied:
//   node scripts/gen-supabase-types.mjs
//
// ⚠️ This checks names and shapes, never permission. A typed query can still
// return nothing because an RLS policy filtered it. See item 84.

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
      admin_audit_log: {
        Row: {
          action: string
          admin_id: string | null
          admin_note: string | null
          created_at: string
          details: Json | null
          id: string
          target_provider_id: string | null
          target_session_id: string | null
          target_user_id: string | null
        }
        Insert: {
          action: string
          admin_id?: string | null
          admin_note?: string | null
          created_at?: string
          details?: Json | null
          id?: string
          target_provider_id?: string | null
          target_session_id?: string | null
          target_user_id?: string | null
        }
        Update: {
          action?: string
          admin_id?: string | null
          admin_note?: string | null
          created_at?: string
          details?: Json | null
          id?: string
          target_provider_id?: string | null
          target_session_id?: string | null
          target_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "admin_audit_log_target_provider_id_fkey"
            columns: ["target_provider_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_audit_log_target_provider_id_fkey"
            columns: ["target_provider_id"]
            isOneToOne: false
            referencedRelation: "public_stylist_reviews"
            referencedColumns: ["provider_id"]
          },
          {
            foreignKeyName: "admin_audit_log_target_provider_id_fkey"
            columns: ["target_provider_id"]
            isOneToOne: false
            referencedRelation: "public_stylists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_audit_log_target_session_id_fkey"
            columns: ["target_session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_audit_log_target_user_id_fkey"
            columns: ["target_user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_audit_log_target_user_id_fkey"
            columns: ["target_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      admins: {
        Row: {
          created_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          user_id?: string
        }
        Relationships: []
      }
      availability: {
        Row: {
          active_treatments: string[]
          date: string
          end_time: string
          id: string
          is_taken: boolean
          price_pence: number | null
          provider_id: string
          start_time: string
        }
        Insert: {
          active_treatments?: string[]
          date: string
          end_time: string
          id?: string
          is_taken?: boolean
          price_pence?: number | null
          provider_id: string
          start_time: string
        }
        Update: {
          active_treatments?: string[]
          date?: string
          end_time?: string
          id?: string
          is_taken?: boolean
          price_pence?: number | null
          provider_id?: string
          start_time?: string
        }
        Relationships: [
          {
            foreignKeyName: "availability_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "availability_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "public_stylist_reviews"
            referencedColumns: ["provider_id"]
          },
          {
            foreignKeyName: "availability_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "public_stylists"
            referencedColumns: ["id"]
          },
        ]
      }
      blocks: {
        Row: {
          blocked_id: string
          blocker_id: string
          created_at: string
        }
        Insert: {
          blocked_id: string
          blocker_id: string
          created_at?: string
        }
        Update: {
          blocked_id?: string
          blocker_id?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "blocks_blocked_id_fkey"
            columns: ["blocked_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "blocks_blocked_id_fkey"
            columns: ["blocked_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "blocks_blocker_id_fkey"
            columns: ["blocker_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "blocks_blocker_id_fkey"
            columns: ["blocker_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      consent_documents: {
        Row: {
          acknowledgements: Json
          body: string
          category_id: string | null
          content_hash: string
          created_at: string
          id: string
          is_active: boolean
          title: string
          version: number
        }
        Insert: {
          acknowledgements?: Json
          body: string
          category_id?: string | null
          content_hash: string
          created_at?: string
          id?: string
          is_active?: boolean
          title: string
          version: number
        }
        Update: {
          acknowledgements?: Json
          body?: string
          category_id?: string | null
          content_hash?: string
          created_at?: string
          id?: string
          is_active?: boolean
          title?: string
          version?: number
        }
        Relationships: []
      }
      email_reconcile_runs: {
        Row: {
          emailable: number
          failed: number
          id: string
          no_attempt: number
          ran_at: string
          sent: number
          skipped: number
          window_hours: number
        }
        Insert: {
          emailable: number
          failed: number
          id?: string
          no_attempt: number
          ran_at?: string
          sent: number
          skipped: number
          window_hours: number
        }
        Update: {
          emailable?: number
          failed?: number
          id?: string
          no_attempt?: number
          ran_at?: string
          sent?: number
          skipped?: number
          window_hours?: number
        }
        Relationships: []
      }
      email_sends: {
        Row: {
          created_at: string
          event: string | null
          id: string
          kind: string
          provider_id: string | null
          reason: string | null
          ref_id: string | null
          status: string
          user_id: string
        }
        Insert: {
          created_at?: string
          event?: string | null
          id?: string
          kind: string
          provider_id?: string | null
          reason?: string | null
          ref_id?: string | null
          status: string
          user_id: string
        }
        Update: {
          created_at?: string
          event?: string | null
          id?: string
          kind?: string
          provider_id?: string | null
          reason?: string | null
          ref_id?: string | null
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_sends_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_sends_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      email_unsubscribe_tokens: {
        Row: {
          created_at: string
          token: string
          user_id: string
        }
        Insert: {
          created_at?: string
          token: string
          user_id: string
        }
        Update: {
          created_at?: string
          token?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_unsubscribe_tokens_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_unsubscribe_tokens_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      favourites: {
        Row: {
          created_at: string
          id: string
          provider_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          provider_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          provider_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "favourites_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "favourites_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "public_stylist_reviews"
            referencedColumns: ["provider_id"]
          },
          {
            foreignKeyName: "favourites_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "public_stylists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "favourites_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "favourites_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      founding_providers: {
        Row: {
          claimed_at: string
          id: string
          slot_number: number
          user_id: string
        }
        Insert: {
          claimed_at?: string
          id?: string
          slot_number: number
          user_id: string
        }
        Update: {
          claimed_at?: string
          id?: string
          slot_number?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "founding_providers_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "founding_providers_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          body: string
          created_at: string
          id: string
          read_at: string | null
          sender_id: string
          session_id: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          read_at?: string | null
          sender_id: string
          session_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          read_at?: string | null
          sender_id?: string
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      migration_findings: {
        Row: {
          id: number
          item: string
          recorded_at: string
          value: string | null
          version: string
        }
        Insert: {
          id?: never
          item: string
          recorded_at?: string
          value?: string | null
          version: string
        }
        Update: {
          id?: never
          item?: string
          recorded_at?: string
          value?: string | null
          version?: string
        }
        Relationships: []
      }
      model_attributes: {
        Row: {
          bio: string | null
          created_at: string | null
          eye_colour: string | null
          eye_colour_custom: string | null
          eye_shape: string | null
          eye_shape_custom: string | null
          hair_colour: string | null
          hair_colour_custom: string | null
          hair_condition: string | null
          hair_condition_custom: string | null
          hair_length: string | null
          hair_length_custom: string | null
          hair_type: string | null
          hair_type_custom: string | null
          id: string
          nail_condition: string | null
          nail_condition_custom: string | null
          skin_tone: string | null
          skin_tone_custom: string | null
          skin_type: string | null
          skin_type_custom: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          bio?: string | null
          created_at?: string | null
          eye_colour?: string | null
          eye_colour_custom?: string | null
          eye_shape?: string | null
          eye_shape_custom?: string | null
          hair_colour?: string | null
          hair_colour_custom?: string | null
          hair_condition?: string | null
          hair_condition_custom?: string | null
          hair_length?: string | null
          hair_length_custom?: string | null
          hair_type?: string | null
          hair_type_custom?: string | null
          id?: string
          nail_condition?: string | null
          nail_condition_custom?: string | null
          skin_tone?: string | null
          skin_tone_custom?: string | null
          skin_type?: string | null
          skin_type_custom?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          bio?: string | null
          created_at?: string | null
          eye_colour?: string | null
          eye_colour_custom?: string | null
          eye_shape?: string | null
          eye_shape_custom?: string | null
          hair_colour?: string | null
          hair_colour_custom?: string | null
          hair_condition?: string | null
          hair_condition_custom?: string | null
          hair_length?: string | null
          hair_length_custom?: string | null
          hair_type?: string | null
          hair_type_custom?: string | null
          id?: string
          nail_condition?: string | null
          nail_condition_custom?: string | null
          skin_tone?: string | null
          skin_tone_custom?: string | null
          skin_type?: string | null
          skin_type_custom?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "model_attributes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "model_attributes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      model_photo_categories: {
        Row: {
          created_at: string
          id: string
          name: string
          sort_order: number
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          sort_order?: number
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          sort_order?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "model_photo_categories_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "model_photo_categories_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      model_photos: {
        Row: {
          caption: string | null
          category_id: string | null
          created_at: string
          id: string
          photo_url: string
          user_id: string
        }
        Insert: {
          caption?: string | null
          category_id?: string | null
          created_at?: string
          id?: string
          photo_url: string
          user_id: string
        }
        Update: {
          caption?: string | null
          category_id?: string | null
          created_at?: string
          id?: string
          photo_url?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "model_photos_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "model_photo_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "model_photos_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "model_photos_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      moderation_actions: {
        Row: {
          action: Database["public"]["Enums"]["moderation_action_type"]
          admin_id: string
          created_at: string
          expires_at: string | null
          id: string
          reason: string
          related_report_id: string | null
          target_email_hash: string
          target_name: string | null
          target_user_id: string
        }
        Insert: {
          action: Database["public"]["Enums"]["moderation_action_type"]
          admin_id?: string
          created_at?: string
          expires_at?: string | null
          id?: string
          reason: string
          related_report_id?: string | null
          target_email_hash: string
          target_name?: string | null
          target_user_id: string
        }
        Update: {
          action?: Database["public"]["Enums"]["moderation_action_type"]
          admin_id?: string
          created_at?: string
          expires_at?: string | null
          id?: string
          reason?: string
          related_report_id?: string | null
          target_email_hash?: string
          target_name?: string | null
          target_user_id?: string
        }
        Relationships: []
      }
      name_changes: {
        Row: {
          changed_at: string
          changed_by: string | null
          id: string
          new_first_name: string
          new_last_initial: string | null
          old_first_name: string | null
          old_last_initial: string | null
          user_id: string
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          id?: string
          new_first_name: string
          new_last_initial?: string | null
          old_first_name?: string | null
          old_last_initial?: string | null
          user_id: string
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          id?: string
          new_first_name?: string
          new_last_initial?: string | null
          old_first_name?: string | null
          old_last_initial?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "name_changes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "name_changes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string
          created_at: string
          data: Json | null
          id: string
          read_at: string | null
          session_id: string | null
          title: string
          type: string
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string
          data?: Json | null
          id?: string
          read_at?: string | null
          session_id?: string | null
          title: string
          type: string
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          data?: Json | null
          id?: string
          read_at?: string | null
          session_id?: string | null
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      patch_test_rules: {
        Row: {
          category_id: string
          label: string | null
          patch_test_validity_days: number
          patch_test_window_hours: number
          requires_patch_test: boolean
        }
        Insert: {
          category_id: string
          label?: string | null
          patch_test_validity_days?: number
          patch_test_window_hours?: number
          requires_patch_test?: boolean
        }
        Update: {
          category_id?: string
          label?: string | null
          patch_test_validity_days?: number
          patch_test_window_hours?: number
          requires_patch_test?: boolean
        }
        Relationships: []
      }
      patch_tests: {
        Row: {
          category_id: string
          created_at: string
          expires_at: string | null
          id: string
          logged_by: string | null
          model_confirmed_at: string | null
          model_email_hash: string
          model_id: string | null
          model_name: string | null
          notes: string | null
          performed_at: string | null
          provider_email_hash: string
          provider_id: string | null
          provider_name: string | null
          result: Database["public"]["Enums"]["patch_test_result"]
        }
        Insert: {
          category_id: string
          created_at?: string
          expires_at?: string | null
          id?: string
          logged_by?: string | null
          model_confirmed_at?: string | null
          model_email_hash: string
          model_id?: string | null
          model_name?: string | null
          notes?: string | null
          performed_at?: string | null
          provider_email_hash: string
          provider_id?: string | null
          provider_name?: string | null
          result?: Database["public"]["Enums"]["patch_test_result"]
        }
        Update: {
          category_id?: string
          created_at?: string
          expires_at?: string | null
          id?: string
          logged_by?: string | null
          model_confirmed_at?: string | null
          model_email_hash?: string
          model_id?: string | null
          model_name?: string | null
          notes?: string | null
          performed_at?: string | null
          provider_email_hash?: string
          provider_id?: string | null
          provider_name?: string | null
          result?: Database["public"]["Enums"]["patch_test_result"]
        }
        Relationships: []
      }
      portfolio_categories: {
        Row: {
          created_at: string
          id: string
          name: string
          provider_id: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          provider_id: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          provider_id?: string
          sort_order?: number
        }
        Relationships: []
      }
      portfolio_items: {
        Row: {
          category_id: string | null
          created_at: string
          id: string
          media_type: string
          media_url: string
          moderation_status: string
          provider_id: string
        }
        Insert: {
          category_id?: string | null
          created_at?: string
          id?: string
          media_type: string
          media_url: string
          moderation_status?: string
          provider_id: string
        }
        Update: {
          category_id?: string | null
          created_at?: string
          id?: string
          media_type?: string
          media_url?: string
          moderation_status?: string
          provider_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "portfolio_items_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "portfolio_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portfolio_items_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portfolio_items_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "public_stylist_reviews"
            referencedColumns: ["provider_id"]
          },
          {
            foreignKeyName: "portfolio_items_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "public_stylists"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_availability: {
        Row: {
          active_treatments: string[] | null
          date: string | null
          end_time: string | null
          id: string | null
          is_taken: boolean | null
          provider_id: string | null
          start_time: string | null
        }
        Insert: {
          active_treatments?: string[] | null
          date?: string | null
          end_time?: string | null
          id?: string | null
          is_taken?: boolean | null
          provider_id?: string | null
          start_time?: string | null
        }
        Update: {
          active_treatments?: string[] | null
          date?: string | null
          end_time?: string | null
          id?: string | null
          is_taken?: boolean | null
          provider_id?: string | null
          start_time?: string | null
        }
        Relationships: []
      }
      provider_treatments: {
        Row: {
          category: string
          created_at: string | null
          description: string | null
          duration: number | null
          id: string
          name: string
          price: number | null
          provider_id: string | null
        }
        Insert: {
          category: string
          created_at?: string | null
          description?: string | null
          duration?: number | null
          id?: string
          name: string
          price?: number | null
          provider_id?: string | null
        }
        Update: {
          category?: string
          created_at?: string | null
          description?: string | null
          duration?: number | null
          id?: string
          name?: string
          price?: number | null
          provider_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "provider_treatments_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_treatments_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "public_stylist_reviews"
            referencedColumns: ["provider_id"]
          },
          {
            foreignKeyName: "provider_treatments_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "public_stylists"
            referencedColumns: ["id"]
          },
        ]
      }
      providers: {
        Row: {
          banner_url: string | null
          bio: string | null
          first_published_at: string | null
          id: string
          is_published: boolean | null
          is_verified: boolean | null
          latitude: number | null
          level: string | null
          location: string | null
          location_text: string | null
          longitude: number | null
          name: string | null
          profile_pic_url: string | null
          rating: number | null
          region: string | null
          review_count: number | null
          shop_handle: string | null
          status_expires_at: string | null
          status_text: string | null
          user_id: string
        }
        Insert: {
          banner_url?: string | null
          bio?: string | null
          first_published_at?: string | null
          id?: string
          is_published?: boolean | null
          is_verified?: boolean | null
          latitude?: number | null
          level?: string | null
          location?: string | null
          location_text?: string | null
          longitude?: number | null
          name?: string | null
          profile_pic_url?: string | null
          rating?: number | null
          region?: string | null
          review_count?: number | null
          shop_handle?: string | null
          status_expires_at?: string | null
          status_text?: string | null
          user_id: string
        }
        Update: {
          banner_url?: string | null
          bio?: string | null
          first_published_at?: string | null
          id?: string
          is_published?: boolean | null
          is_verified?: boolean | null
          latitude?: number | null
          level?: string | null
          location?: string | null
          location_text?: string | null
          longitude?: number | null
          name?: string | null
          profile_pic_url?: string | null
          rating?: number | null
          region?: string | null
          review_count?: number | null
          shop_handle?: string | null
          status_expires_at?: string | null
          status_text?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "providers_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "providers_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      push_tokens: {
        Row: {
          id: string
          platform: string | null
          token: string
          updated_at: string
          user_id: string
        }
        Insert: {
          id?: string
          platform?: string | null
          token: string
          updated_at?: string
          user_id: string
        }
        Update: {
          id?: string
          platform?: string | null
          token?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      reports: {
        Row: {
          created_at: string
          details: string | null
          evidence_urls: string[] | null
          id: string
          reason: string
          reason_code: string | null
          reported_email_hash: string
          reported_id: string | null
          reported_name: string | null
          reporter_email_hash: string
          reporter_id: string | null
          reporter_name: string | null
          resolution: string | null
          resolved_at: string | null
          reviewed_by: string | null
          session_id: string | null
          status: string
        }
        Insert: {
          created_at?: string
          details?: string | null
          evidence_urls?: string[] | null
          id?: string
          reason: string
          reason_code?: string | null
          reported_email_hash: string
          reported_id?: string | null
          reported_name?: string | null
          reporter_email_hash: string
          reporter_id?: string | null
          reporter_name?: string | null
          resolution?: string | null
          resolved_at?: string | null
          reviewed_by?: string | null
          session_id?: string | null
          status?: string
        }
        Update: {
          created_at?: string
          details?: string | null
          evidence_urls?: string[] | null
          id?: string
          reason?: string
          reason_code?: string | null
          reported_email_hash?: string
          reported_id?: string | null
          reported_name?: string | null
          reporter_email_hash?: string
          reporter_id?: string | null
          reporter_name?: string | null
          resolution?: string | null
          resolved_at?: string | null
          reviewed_by?: string | null
          session_id?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "reports_reported_id_fkey"
            columns: ["reported_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_reported_id_fkey"
            columns: ["reported_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_reporter_id_fkey"
            columns: ["reporter_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_reporter_id_fkey"
            columns: ["reporter_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      retention_runs: {
        Row: {
          dry_run: boolean
          duration_ms: number | null
          id: number
          ok: boolean
          ran_at: string
          results: Json
        }
        Insert: {
          dry_run: boolean
          duration_ms?: number | null
          id?: number
          ok: boolean
          ran_at?: string
          results: Json
        }
        Update: {
          dry_run?: boolean
          duration_ms?: number | null
          id?: number
          ok?: boolean
          ran_at?: string
          results?: Json
        }
        Relationships: []
      }
      reviews: {
        Row: {
          comfort_rating: number | null
          comment: string | null
          created_at: string
          friendliness_rating: number | null
          id: string
          overall_rating: number
          punctuality_rating: number | null
          quality_rating: number | null
          reviewee_id: string
          reviewer_id: string
          session_id: string
          tags: string[]
        }
        Insert: {
          comfort_rating?: number | null
          comment?: string | null
          created_at?: string
          friendliness_rating?: number | null
          id?: string
          overall_rating: number
          punctuality_rating?: number | null
          quality_rating?: number | null
          reviewee_id: string
          reviewer_id: string
          session_id: string
          tags?: string[]
        }
        Update: {
          comfort_rating?: number | null
          comment?: string | null
          created_at?: string
          friendliness_rating?: number | null
          id?: string
          overall_rating?: number
          punctuality_rating?: number | null
          quality_rating?: number | null
          reviewee_id?: string
          reviewer_id?: string
          session_id?: string
          tags?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "reviews_reviewee_id_fkey"
            columns: ["reviewee_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_reviewee_id_fkey"
            columns: ["reviewee_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_reviewer_id_fkey"
            columns: ["reviewer_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_reviewer_id_fkey"
            columns: ["reviewer_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      schema_migrations: {
        Row: {
          applied_at: string
          applied_by: string
          checksum: string
          name: string
          version: string
        }
        Insert: {
          applied_at?: string
          applied_by?: string
          checksum: string
          name: string
          version: string
        }
        Update: {
          applied_at?: string
          applied_by?: string
          checksum?: string
          name?: string
          version?: string
        }
        Relationships: []
      }
      session_consents: {
        Row: {
          acknowledgements: Json
          agreed_at: string
          category_id: string | null
          consent_document_id: string
          consent_version: number
          content_hash: string
          id: string
          session_id: string
          subject_email_hash: string | null
          subject_name: string | null
          user_id: string
        }
        Insert: {
          acknowledgements: Json
          agreed_at?: string
          category_id?: string | null
          consent_document_id: string
          consent_version: number
          content_hash: string
          id?: string
          session_id: string
          subject_email_hash?: string | null
          subject_name?: string | null
          user_id?: string
        }
        Update: {
          acknowledgements?: Json
          agreed_at?: string
          category_id?: string | null
          consent_document_id?: string
          consent_version?: number
          content_hash?: string
          id?: string
          session_id?: string
          subject_email_hash?: string | null
          subject_name?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_consents_consent_document_id_fkey"
            columns: ["consent_document_id"]
            isOneToOne: false
            referencedRelation: "consent_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      sessions: {
        Row: {
          availability_id: string
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          completed_at: string | null
          created_at: string
          currency_code: string
          date: string | null
          duration_minutes: number
          end_time: string | null
          id: string
          location_type: string
          materials_cost: number
          model_id: string
          model_note: string | null
          model_user_id: string | null
          note: string | null
          photo_urls: string[] | null
          price_pence: number | null
          provider_id: string
          scheduled_at: string
          start_time: string | null
          status: string
          treatment_id: string
        }
        Insert: {
          availability_id: string
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          completed_at?: string | null
          created_at?: string
          currency_code?: string
          date?: string | null
          duration_minutes: number
          end_time?: string | null
          id?: string
          location_type: string
          materials_cost?: number
          model_id: string
          model_note?: string | null
          model_user_id?: string | null
          note?: string | null
          photo_urls?: string[] | null
          price_pence?: number | null
          provider_id: string
          scheduled_at: string
          start_time?: string | null
          status?: string
          treatment_id: string
        }
        Update: {
          availability_id?: string
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          completed_at?: string | null
          created_at?: string
          currency_code?: string
          date?: string | null
          duration_minutes?: number
          end_time?: string | null
          id?: string
          location_type?: string
          materials_cost?: number
          model_id?: string
          model_note?: string | null
          model_user_id?: string | null
          note?: string | null
          photo_urls?: string[] | null
          price_pence?: number | null
          provider_id?: string
          scheduled_at?: string
          start_time?: string | null
          status?: string
          treatment_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sessions_availability_id_fkey"
            columns: ["availability_id"]
            isOneToOne: false
            referencedRelation: "availability"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sessions_model_id_fkey"
            columns: ["model_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sessions_model_id_fkey"
            columns: ["model_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sessions_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sessions_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "public_stylist_reviews"
            referencedColumns: ["provider_id"]
          },
          {
            foreignKeyName: "sessions_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "public_stylists"
            referencedColumns: ["id"]
          },
        ]
      }
      settings: {
        Row: {
          key: string
          updated_at: string
          value: string
        }
        Insert: {
          key: string
          updated_at?: string
          value: string
        }
        Update: {
          key?: string
          updated_at?: string
          value?: string
        }
        Relationships: []
      }
      status_posts: {
        Row: {
          body: string
          created_at: string
          expires_at: string
          id: string
          moderation_status: string
          provider_id: string
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
        }
        Insert: {
          body: string
          created_at?: string
          expires_at?: string
          id?: string
          moderation_status?: string
          provider_id: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
        }
        Update: {
          body?: string
          created_at?: string
          expires_at?: string
          id?: string
          moderation_status?: string
          provider_id?: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "status_posts_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "status_posts_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "public_stylist_reviews"
            referencedColumns: ["provider_id"]
          },
          {
            foreignKeyName: "status_posts_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "public_stylists"
            referencedColumns: ["id"]
          },
        ]
      }
      stripe_webhook_events: {
        Row: {
          detail: string | null
          id: string
          outcome: string
          received_at: string
          type: string
          user_id: string | null
        }
        Insert: {
          detail?: string | null
          id: string
          outcome: string
          received_at?: string
          type: string
          user_id?: string | null
        }
        Update: {
          detail?: string | null
          id?: string
          outcome?: string
          received_at?: string
          type?: string
          user_id?: string | null
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          amount_pence: number | null
          cancelled_at: string | null
          created_at: string
          currency_code: string
          current_period_end: string | null
          current_period_start: string | null
          id: string
          plan: string
          status: string
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          user_id: string
        }
        Insert: {
          amount_pence?: number | null
          cancelled_at?: string | null
          created_at?: string
          currency_code?: string
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          plan?: string
          status: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          user_id: string
        }
        Update: {
          amount_pence?: number | null
          cancelled_at?: string | null
          created_at?: string
          currency_code?: string
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          plan?: string
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      suspensions: {
        Row: {
          banned: boolean
          created_at: string
          id: string
          member_message: string | null
          reason: string
          suspended_until: string | null
          user_id: string
        }
        Insert: {
          banned?: boolean
          created_at?: string
          id?: string
          member_message?: string | null
          reason: string
          suspended_until?: string | null
          user_id: string
        }
        Update: {
          banned?: boolean
          created_at?: string
          id?: string
          member_message?: string | null
          reason?: string
          suspended_until?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "suspensions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "suspensions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      treatment_categories: {
        Row: {
          colour_hex: string | null
          icon_name: string | null
          id: string
          is_active: boolean
          name: string
          slug: string
          sort_order: number
        }
        Insert: {
          colour_hex?: string | null
          icon_name?: string | null
          id?: string
          is_active?: boolean
          name: string
          slug: string
          sort_order?: number
        }
        Update: {
          colour_hex?: string | null
          icon_name?: string | null
          id?: string
          is_active?: boolean
          name?: string
          slug?: string
          sort_order?: number
        }
        Relationships: []
      }
      treatments: {
        Row: {
          category_id: string
          currency_code: string
          duration_minutes: number
          id: string
          is_active: boolean
          materials_cost: number
          materials_desc: string | null
          name: string
          provider_id: string
        }
        Insert: {
          category_id: string
          currency_code?: string
          duration_minutes: number
          id?: string
          is_active?: boolean
          materials_cost?: number
          materials_desc?: string | null
          name: string
          provider_id: string
        }
        Update: {
          category_id?: string
          currency_code?: string
          duration_minutes?: number
          id?: string
          is_active?: boolean
          materials_cost?: number
          materials_desc?: string | null
          name?: string
          provider_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "treatments_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "treatment_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "treatments_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "treatments_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "public_stylist_reviews"
            referencedColumns: ["provider_id"]
          },
          {
            foreignKeyName: "treatments_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "public_stylists"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          created_at: string
          date_of_birth: string | null
          email: string
          first_name: string
          fraud_flagged: boolean
          id: string
          instagram_handle: string | null
          is_founding_provider: boolean
          is_verified: boolean
          last_initial: string | null
          last_name: string | null
          latitude: number | null
          longitude: number | null
          notification_preferences: Json | null
          postcode: string | null
          profile_pic_reviewed_at: string | null
          profile_pic_reviewed_by: string | null
          profile_pic_updated_at: string | null
          profile_pic_url: string | null
          provider_fee_waived: boolean
          region: string
          role: string
          subscription_expires_at: string | null
          subscription_next_billing: string | null
          subscription_status: string
          subscription_waived: boolean
          terms_accepted_at: string | null
        }
        Insert: {
          created_at?: string
          date_of_birth?: string | null
          email: string
          first_name: string
          fraud_flagged?: boolean
          id?: string
          instagram_handle?: string | null
          is_founding_provider?: boolean
          is_verified?: boolean
          last_initial?: string | null
          last_name?: string | null
          latitude?: number | null
          longitude?: number | null
          notification_preferences?: Json | null
          postcode?: string | null
          profile_pic_reviewed_at?: string | null
          profile_pic_reviewed_by?: string | null
          profile_pic_updated_at?: string | null
          profile_pic_url?: string | null
          provider_fee_waived?: boolean
          region: string
          role: string
          subscription_expires_at?: string | null
          subscription_next_billing?: string | null
          subscription_status?: string
          subscription_waived?: boolean
          terms_accepted_at?: string | null
        }
        Update: {
          created_at?: string
          date_of_birth?: string | null
          email?: string
          first_name?: string
          fraud_flagged?: boolean
          id?: string
          instagram_handle?: string | null
          is_founding_provider?: boolean
          is_verified?: boolean
          last_initial?: string | null
          last_name?: string | null
          latitude?: number | null
          longitude?: number | null
          notification_preferences?: Json | null
          postcode?: string | null
          profile_pic_reviewed_at?: string | null
          profile_pic_reviewed_by?: string | null
          profile_pic_updated_at?: string | null
          profile_pic_url?: string | null
          provider_fee_waived?: boolean
          region?: string
          role?: string
          subscription_expires_at?: string | null
          subscription_next_billing?: string | null
          subscription_status?: string
          subscription_waived?: boolean
          terms_accepted_at?: string | null
        }
        Relationships: []
      }
      verification_attempts: {
        Row: {
          created_at: string
          id: string
          passed: boolean
          selfie_url: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          passed?: boolean
          selfie_url?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          passed?: boolean
          selfie_url?: string | null
          user_id?: string
        }
        Relationships: []
      }
      verification_payments: {
        Row: {
          amount: number
          created_at: string
          currency_code: string
          id: string
          locked_until: string | null
          payment_captured_at: string | null
          retry_count: number
          selfie_checked_at: string | null
          selfie_status: string
          stripe_payment_id: string
          user_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          currency_code?: string
          id?: string
          locked_until?: string | null
          payment_captured_at?: string | null
          retry_count?: number
          selfie_checked_at?: string | null
          selfie_status?: string
          stripe_payment_id: string
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          currency_code?: string
          id?: string
          locked_until?: string | null
          payment_captured_at?: string | null
          retry_count?: number
          selfie_checked_at?: string | null
          selfie_status?: string
          stripe_payment_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "verification_payments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "verification_payments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      verification_requests: {
        Row: {
          created_at: string | null
          id: string
          notes: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          reviewed_by_source: string | null
          selfie_url: string | null
          status: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewed_by_source?: string | null
          selfie_url?: string | null
          status?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewed_by_source?: string | null
          selfie_url?: string | null
          status?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "verification_requests_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "verification_requests_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      waitlist: {
        Row: {
          city: string | null
          consent: boolean
          created_at: string
          email: string
          first_name: string
          id: string
          role: string
          social_handle: string | null
        }
        Insert: {
          city?: string | null
          consent?: boolean
          created_at?: string
          email: string
          first_name: string
          id?: string
          role: string
          social_handle?: string | null
        }
        Update: {
          city?: string | null
          consent?: boolean
          created_at?: string
          email?: string
          first_name?: string
          id?: string
          role?: string
          social_handle?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      public_categories: {
        Row: {
          colour_hex: string | null
          icon_name: string | null
          name: string | null
          slug: string | null
          sort_order: number | null
        }
        Insert: {
          colour_hex?: string | null
          icon_name?: string | null
          name?: string | null
          slug?: string | null
          sort_order?: number | null
        }
        Update: {
          colour_hex?: string | null
          icon_name?: string | null
          name?: string | null
          slug?: string | null
          sort_order?: number | null
        }
        Relationships: []
      }
      public_profiles: {
        Row: {
          first_name: string | null
          id: string | null
          instagram_handle: string | null
          last_initial: string | null
          profile_pic_url: string | null
        }
        Insert: {
          first_name?: string | null
          id?: string | null
          instagram_handle?: string | null
          last_initial?: string | null
          profile_pic_url?: string | null
        }
        Update: {
          first_name?: string | null
          id?: string | null
          instagram_handle?: string | null
          last_initial?: string | null
          profile_pic_url?: string | null
        }
        Relationships: []
      }
      public_stylist_portfolio: {
        Row: {
          category_name: string | null
          created_at: string | null
          id: string | null
          media_type: string | null
          media_url: string | null
          poster_url: string | null
          provider_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "portfolio_items_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portfolio_items_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "public_stylist_reviews"
            referencedColumns: ["provider_id"]
          },
          {
            foreignKeyName: "portfolio_items_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "public_stylists"
            referencedColumns: ["id"]
          },
        ]
      }
      public_stylist_reviews: {
        Row: {
          comment: string | null
          created_at: string | null
          id: string | null
          provider_id: string | null
          rating: number | null
          tags: string[] | null
        }
        Relationships: []
      }
      public_stylist_status: {
        Row: {
          body: string | null
          created_at: string | null
          expires_at: string | null
          id: string | null
          provider_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "status_posts_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "status_posts_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "public_stylist_reviews"
            referencedColumns: ["provider_id"]
          },
          {
            foreignKeyName: "status_posts_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "public_stylists"
            referencedColumns: ["id"]
          },
        ]
      }
      public_stylists: {
        Row: {
          banner_url: string | null
          bio: string | null
          categories: string[] | null
          category_slugs: string[] | null
          has_open_slots: boolean | null
          id: string | null
          is_verified: boolean | null
          location: string | null
          location_slug: string | null
          name: string | null
          profile_pic_url: string | null
          rating: number | null
          region: string | null
          review_count: number | null
          short_id: string | null
          slug: string | null
          status_text: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      _admin_apply_user_action: {
        Args: {
          p_action: string
          p_duration_days: number
          p_message?: string
          p_reason: string
          p_user_id: string
        }
        Returns: Json
      }
      _provider_shops_state: { Args: { p_user_id: string }; Returns: Json }
      _withdraw_stylist: { Args: { p_user_id: string }; Returns: Json }
      _withdrawn_sentence: { Args: { p_withdrawn: Json }; Returns: string }
      admin_act_on_provider: {
        Args: {
          p_action: string
          p_duration_days?: number
          p_message?: string
          p_provider_id: string
          p_reason?: string
        }
        Returns: Json
      }
      admin_act_on_report: {
        Args: {
          p_action: string
          p_duration_days?: number
          p_message?: string
          p_reason?: string
          p_report_id: string
        }
        Returns: Json
      }
      admin_act_on_user: {
        Args: {
          p_action: string
          p_duration_days?: number
          p_message?: string
          p_reason?: string
          p_user_id: string
        }
        Returns: Json
      }
      admin_decide_status_post: {
        Args: { p_decision: string; p_note?: string; p_post_id: string }
        Returns: Json
      }
      admin_decide_verification: {
        Args: { p_decision: string; p_note?: string; p_request_id: string }
        Returns: Json
      }
      admin_mark_profile_pic_seen: {
        Args: { p_user_id: string }
        Returns: Json
      }
      apply_subscription_state: {
        Args: {
          p_amount_pence?: number
          p_currency_code?: string
          p_customer_id?: string
          p_period_end?: string
          p_period_start?: string
          p_plan?: string
          p_status: string
          p_subscription_id?: string
          p_user_id: string
        }
        Returns: undefined
      }
      banned_word_hit: { Args: { p_text: string }; Returns: string }
      banned_words_check: { Args: { p_text: string }; Returns: string }
      bio_publish_problem: { Args: { p_bio: string }; Returns: string }
      cancel_booking: {
        Args: { p_reason?: string; p_session_id: string }
        Returns: Json
      }
      cancel_sessions_for_block: {
        Args: { p_other_user_id: string }
        Returns: Json
      }
      cancellation_notice: {
        Args: {
          p_date: string
          p_kind: string
          p_other_name: string
          p_reason?: string
          p_start_time?: string
          p_treatment?: string
        }
        Returns: {
          body: string
          title: string
        }[]
      }
      confirm_patch_test: { Args: { p_test_id: string }; Returns: undefined }
      create_session_with_consent: {
        Args: {
          p_acknowledgements: Json
          p_availability_id: string
          p_category_id?: string
          p_consent_document_id: string
          p_consent_version: number
          p_content_hash: string
          p_date: string
          p_duration_minutes: number
          p_end_time: string
          p_location_type: string
          p_note: string
          p_photo_urls: string[]
          p_provider_id: string
          p_scheduled_at: string
          p_start_time: string
          p_treatment_id: string
        }
        Returns: string
      }
      delete_account_data: { Args: { p_user: string }; Returns: Json }
      email_unsubscribe_token: { Args: { p_user_id: string }; Returns: string }
      has_open_availability: {
        Args: { p_provider_id: string }
        Returns: boolean
      }
      has_session_with_provider: {
        Args: { p_provider_id: string }
        Returns: boolean
      }
      has_valid_patch_test: {
        Args: { p_category: string; p_model: string; p_provider: string }
        Returns: boolean
      }
      install_email_hook_secret: { Args: { p_secret: string }; Returns: string }
      is_admin: { Args: never; Returns: boolean }
      is_blocked_pair: { Args: { a: string; b: string }; Returns: boolean }
      is_suspended: { Args: { uid: string }; Returns: boolean }
      model_may_apply:
        | { Args: never; Returns: boolean }
        | { Args: { p_user_id: string }; Returns: boolean }
      my_suspension: {
        Args: never
        Returns: {
          banned: boolean
          message: string
          suspended_until: string
        }[]
      }
      nearby_models: {
        Args: { p_lat?: number; p_lng?: number; p_radius_mi?: number }
        Returns: {
          distance_mi: number
          first_name: string
          hair_colour: string
          hair_length: string
          hair_type: string
          id: string
          is_verified: boolean
          last_initial: string
          profile_pic_url: string
          skin_tone: string
        }[]
      }
      provider_fee_settled: { Args: { p_user_id: string }; Returns: boolean }
      provider_shop_is_publishable: {
        Args: { p_provider_id: string }
        Returns: boolean
      }
      publish_provider_if_eligible: {
        Args: { p_provider_id: string }
        Returns: undefined
      }
      report_subject_history: {
        Args: never
        Returns: {
          child_safety_reports: number
          last_child_safety_at: string
          reported_email_hash: string
          total_reports: number
        }[]
      }
      revoke_verification: {
        Args: { p_message?: string; p_reason: string; p_user_id: string }
        Returns: Json
      }
      run_email_reconcile: {
        Args: { p_hours?: number }
        Returns: {
          emailable: number
          failed: number
          id: string
          no_attempt: number
          ran_at: string
          sent: number
          skipped: number
          window_hours: number
        }
        SetofOptions: {
          from: "*"
          to: "email_reconcile_runs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      run_retention_purge: { Args: { p_dry_run?: boolean }; Returns: Json }
      set_my_postcode: {
        Args: { p_lat?: number; p_lng?: number; p_postcode?: string }
        Returns: undefined
      }
      stripe_webhook_health: {
        Args: never
        Returns: {
          events_7d: number
          failures_7d: number
          last_event_at: string
          last_event_type: string
          last_failure_at: string
          last_failure_note: string
        }[]
      }
      taken_slots: {
        Args: { p_date: string; p_provider_id: string }
        Returns: {
          end_time: string
          start_time: string
        }[]
      }
      unsubscribe_email: { Args: { p_token: string }; Returns: boolean }
    }
    Enums: {
      moderation_action_type:
        | "warn"
        | "suspend"
        | "ban"
        | "reinstate"
        | "dismiss"
        | "revoke_verification"
      patch_test_result: "pending" | "pass" | "reaction" | "fail"
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
      moderation_action_type: [
        "warn",
        "suspend",
        "ban",
        "reinstate",
        "dismiss",
        "revoke_verification",
      ],
      patch_test_result: ["pending", "pass", "reaction", "fail"],
    },
  },
} as const
