
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "businesses": {
                  Row: {
                    "created_at": string,"description": string,"id": string,"name": string,"slug": string,"timezone": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"description"?: string,"id"?: string,"name": string,"slug": string,"timezone"?: string
                  }
                  Update: {
                    "created_at"?: string,"description"?: string,"id"?: string,"name"?: string,"slug"?: string,"timezone"?: string
                  }
                  Relationships: [
                    
                  ]
                },"chunks": {
                  Row: {
                    "business_id": string,"chunk_index": number,"content": string,"document_id": string,"embedding": string,"fts": unknown,"heading": string,"id": number,"token_count": number
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"chunk_index": number,"content": string,"document_id": string,"embedding": string,"fts"?: never,"heading"?: string,"id"?: never,"token_count": number
                  }
                  Update: {
                    "business_id"?: string,"chunk_index"?: number,"content"?: string,"document_id"?: string,"embedding"?: string,"fts"?: never,"heading"?: string,"id"?: never,"token_count"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "chunks_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "chunks_document_id_fkey"
      columns: ["document_id"]
isOneToOne: false
      referencedRelation: "documents"
      referencedColumns: ["id"]
    }
                  ]
                },"consultation_requests": {
                  Row: {
                    "business_id": string,"contact_email": string | null,"contact_name": string,"contact_phone": string | null,"conversation_id": string | null,"created_at": string,"id": string,"lead_id": string,"notes": string | null,"preferred_at": string,"service": string,"status": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"contact_email"?: string | null,"contact_name": string,"contact_phone"?: string | null,"conversation_id"?: string | null,"created_at"?: string,"id"?: string,"lead_id": string,"notes"?: string | null,"preferred_at": string,"service": string,"status"?: string,"updated_at"?: string
                  }
                  Update: {
                    "business_id"?: string,"contact_email"?: string | null,"contact_name"?: string,"contact_phone"?: string | null,"conversation_id"?: string | null,"created_at"?: string,"id"?: string,"lead_id"?: string,"notes"?: string | null,"preferred_at"?: string,"service"?: string,"status"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "consultation_requests_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "consultation_requests_conversation_id_fkey"
      columns: ["conversation_id"]
isOneToOne: false
      referencedRelation: "conversations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "consultation_requests_lead_id_fkey"
      columns: ["lead_id"]
isOneToOne: false
      referencedRelation: "leads"
      referencedColumns: ["id"]
    }
                  ]
                },"conversations": {
                  Row: {
                    "business_id": string,"created_at": string,"customer_facts": NonNullable<Json>,"id": string,"last_message_at": string,"lead_id": string | null,"session_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"created_at"?: string,"customer_facts"?: NonNullable<Json>,"id"?: string,"last_message_at"?: string,"lead_id"?: string | null,"session_id": string
                  }
                  Update: {
                    "business_id"?: string,"created_at"?: string,"customer_facts"?: NonNullable<Json>,"id"?: string,"last_message_at"?: string,"lead_id"?: string | null,"session_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "conversations_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "conversations_lead_id_fkey"
      columns: ["lead_id"]
isOneToOne: false
      referencedRelation: "leads"
      referencedColumns: ["id"]
    }
                  ]
                },"documents": {
                  Row: {
                    "business_id": string,"chunk_count": number,"content_hash": string,"created_at": string,"embedding_model": string,"error": string | null,"id": string,"source_type": string,"status": string,"title": string
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"chunk_count"?: number,"content_hash": string,"created_at"?: string,"embedding_model": string,"error"?: string | null,"id"?: string,"source_type": string,"status"?: string,"title": string
                  }
                  Update: {
                    "business_id"?: string,"chunk_count"?: number,"content_hash"?: string,"created_at"?: string,"embedding_model"?: string,"error"?: string | null,"id"?: string,"source_type"?: string,"status"?: string,"title"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "documents_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    }
                  ]
                },"leads": {
                  Row: {
                    "business_id": string,"created_at": string,"email": string | null,"id": string,"interest": string | null,"name": string,"phone": string | null,"source_channel": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"created_at"?: string,"email"?: string | null,"id"?: string,"interest"?: string | null,"name": string,"phone"?: string | null,"source_channel": string,"updated_at"?: string
                  }
                  Update: {
                    "business_id"?: string,"created_at"?: string,"email"?: string | null,"id"?: string,"interest"?: string | null,"name"?: string,"phone"?: string | null,"source_channel"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "leads_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    }
                  ]
                },"messages": {
                  Row: {
                    "actions": NonNullable<Json>,"channel": string,"client_message_id": string | null,"content": string | null,"conversation_id": string,"created_at": string,"id": number,"reply_attempt_at": string,"reply_failed_at": string | null,"reply_to_message_id": number | null,"role": string,"sources": NonNullable<Json>
                  }
                  ComputedFields: never
                  Insert: {
                    "actions"?: NonNullable<Json>,"channel"?: string,"client_message_id"?: string | null,"content"?: string | null,"conversation_id": string,"created_at"?: string,"id"?: never,"reply_attempt_at"?: string,"reply_failed_at"?: string | null,"reply_to_message_id"?: number | null,"role": string,"sources"?: NonNullable<Json>
                  }
                  Update: {
                    "actions"?: NonNullable<Json>,"channel"?: string,"client_message_id"?: string | null,"content"?: string | null,"conversation_id"?: string,"created_at"?: string,"id"?: never,"reply_attempt_at"?: string,"reply_failed_at"?: string | null,"reply_to_message_id"?: number | null,"role"?: string,"sources"?: NonNullable<Json>
                  }
                  Relationships: [
                    {
      foreignKeyName: "messages_conversation_id_fkey"
      columns: ["conversation_id"]
isOneToOne: false
      referencedRelation: "conversations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "messages_reply_to_message_id_fkey"
      columns: ["reply_to_message_id"]
isOneToOne: true
      referencedRelation: "messages"
      referencedColumns: ["id"]
    }
                  ]
                },"tool_calls": {
                  Row: {
                    "arguments": NonNullable<Json>,"channel": string,"conversation_id": string,"created_at": string,"duration_ms": number,"id": number,"message_id": number | null,"name": string,"ok": boolean,"realtime_call_id": string | null,"result": NonNullable<Json>,"sources": NonNullable<Json>,"voice_call_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "arguments": NonNullable<Json>,"channel": string,"conversation_id": string,"created_at"?: string,"duration_ms": number,"id"?: never,"message_id"?: number | null,"name": string,"ok": boolean,"realtime_call_id"?: string | null,"result": NonNullable<Json>,"sources"?: NonNullable<Json>,"voice_call_id"?: string | null
                  }
                  Update: {
                    "arguments"?: NonNullable<Json>,"channel"?: string,"conversation_id"?: string,"created_at"?: string,"duration_ms"?: number,"id"?: never,"message_id"?: number | null,"name"?: string,"ok"?: boolean,"realtime_call_id"?: string | null,"result"?: NonNullable<Json>,"sources"?: NonNullable<Json>,"voice_call_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "tool_calls_conversation_id_fkey"
      columns: ["conversation_id"]
isOneToOne: false
      referencedRelation: "conversations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "tool_calls_message_id_fkey"
      columns: ["message_id"]
isOneToOne: false
      referencedRelation: "messages"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "tool_calls_voice_call_id_fkey"
      columns: ["voice_call_id"]
isOneToOne: false
      referencedRelation: "voice_calls"
      referencedColumns: ["id"]
    }
                  ]
                },"voice_calls": {
                  Row: {
                    "conversation_id": string,"created_at": string,"expires_at": string,"id": string,"openai_call_id": string | null,"token_hash": string
                  }
                  ComputedFields: never
                  Insert: {
                    "conversation_id": string,"created_at"?: string,"expires_at": string,"id"?: string,"openai_call_id"?: string | null,"token_hash": string
                  }
                  Update: {
                    "conversation_id"?: string,"created_at"?: string,"expires_at"?: string,"id"?: string,"openai_call_id"?: string | null,"token_hash"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "voice_calls_conversation_id_fkey"
      columns: ["conversation_id"]
isOneToOne: false
      referencedRelation: "conversations"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "begin_user_message":
{ Args: { "p_channel"?: string,"p_client_message_id": string,"p_content": string,"p_conversation_id": string,"p_window_seconds": number }; Returns: Json
                           },
"claim_reply_attempt":
{ Args: { "p_message_id": number,"p_window_seconds": number }; Returns: boolean
                           },
"commit_document_chunks":
{ Args: { "p_chunks": Json,"p_document_id": string,"p_replaces_document_id"?: string }; Returns: number
                           },
"create_consultation_request":
{ Args: { "p_business_id": string,"p_conversation_id": string,"p_notes"?: string,"p_preferred_at": string,"p_service": string }; Returns: Json
                           },
"hybrid_search":
{ Args: { "p_business_id": string,"p_candidates"?: number,"p_match_count"?: number,"p_query_embedding": string,"p_query_text": string }; Returns: {
              "chunk_id": number,"content": string,"document_id": string,"document_title": string,"heading": string,"keyword_rank": number,"score": number,"similarity": number
            }[]
                           },
"keyword_query":
{ Args: { "p_business_id": string,"p_text": string }; Returns: unknown
                           },
"match_chunks":
{ Args: { "p_business_id": string,"p_match_count": number,"p_min_similarity": number,"p_query_embedding": string }; Returns: {
              "chunk_id": number,"content": string,"document_id": string,"document_title": string,"heading": string,"similarity": number
            }[]
                           },
"save_lead":
{ Args: { "p_business_id": string,"p_channel": string,"p_conversation_id": string,"p_email"?: string,"p_interest"?: string,"p_name": string,"p_phone"?: string }; Returns: Json
                           },
"turn_in_progress":
{ Args: { "p_conversation_id": string,"p_except_message_id": number,"p_window_seconds": number }; Returns: boolean
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "public": {
          Enums: {
            
          }
        }
} as const
