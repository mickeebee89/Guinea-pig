'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { logAction } from '@/lib/audit'

interface Category {
  id: string
  name: string
  slug: string
  icon_name: string | null
  colour_hex: string | null
  is_active: boolean
  sort_order: number
}

const empty = (): Omit<Category, 'id'> => ({
  name: '', slug: '', icon_name: '', colour_hex: '#C8788A', is_active: true, sort_order: 0,
})

export default function CategoriesPage() {
  const [cats, setCats]       = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Category | null>(null)
  const [adding, setAdding]   = useState(false)
  const [form, setForm]       = useState(empty())

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('treatment_categories').select('*').order('sort_order').order('name')
    setCats((data as Category[]) ?? [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  function startEdit(c: Category) {
    setEditing(c)
    setAdding(false)
    setForm({ name: c.name, slug: c.slug, icon_name: c.icon_name ?? '', colour_hex: c.colour_hex ?? '#C8788A', is_active: c.is_active, sort_order: c.sort_order })
  }

  function startAdd() {
    setAdding(true)
    setEditing(null)
    setForm(empty())
  }

  async function save() {
    const payload = {
      name: form.name,
      slug: form.slug || form.name.toLowerCase().replace(/\s+/g, '-'),
      icon_name: form.icon_name || null,
      colour_hex: form.colour_hex || null,
      is_active: form.is_active,
      sort_order: Number(form.sort_order),
    }
    if (editing) {
      await supabase.from('treatment_categories').update(payload).eq('id', editing.id)
      await logAction('category_update', { details: { category_id: editing.id, ...payload } })
    } else {
      const { data } = await supabase.from('treatment_categories').insert(payload).select().single()
      await logAction('category_create', { details: { category_id: (data as Category)?.id, ...payload } })
    }
    setEditing(null)
    setAdding(false)
    load()
  }

  async function toggleActive(c: Category) {
    await supabase.from('treatment_categories').update({ is_active: !c.is_active }).eq('id', c.id)
    await logAction('category_toggle', { details: { category_id: c.id, is_active: !c.is_active } })
    load()
  }

  const field = (label: string, key: keyof typeof form, type = 'text') => (
    <div>
      <label className="text-xs font-medium text-[#3D2E2E]/60 block mb-1">{label}</label>
      <input
        type={type}
        value={String(form[key])}
        onChange={e => setForm(f => ({ ...f, [key]: type === 'number' ? Number(e.target.value) : e.target.value }))}
        className="border border-black/10 rounded-lg px-3 py-2 text-sm w-full bg-white"
      />
    </div>
  )

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-[#3D2E2E]">Treatment Categories</h1>
        <button onClick={startAdd}
          className="px-4 py-2 text-sm font-medium text-white rounded-lg hover:opacity-80 transition-opacity"
          style={{ backgroundColor: '#8C4A58' }}>
          + Add Category
        </button>
      </div>

      <div className="grid grid-cols-1 gap-3 mb-6">
        {loading ? (
          <div className="text-[#3D2E2E]/40 text-sm">Loading…</div>
        ) : cats.map(c => (
          <div key={c.id} className={`bg-white rounded-xl border border-black/5 shadow-sm px-5 py-4 flex items-center gap-4 ${!c.is_active ? 'opacity-50' : ''}`}>
            <div className="w-8 h-8 rounded-full flex items-center justify-center text-lg" style={{ backgroundColor: c.colour_hex ?? '#C8788A' }}>
              {c.icon_name ?? ''}
            </div>
            <div className="flex-1">
              <div className="font-medium text-[#3D2E2E]">{c.name}</div>
              <div className="text-xs text-[#3D2E2E]/40">/{c.slug} · order {c.sort_order}</div>
            </div>
            <div className="flex items-center gap-3">
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${c.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                {c.is_active ? 'Active' : 'Inactive'}
              </span>
              <button onClick={() => toggleActive(c)}
                className="text-xs px-3 py-1 rounded-md bg-gray-100 text-gray-600 hover:bg-gray-200">
                {c.is_active ? 'Deactivate' : 'Activate'}
              </button>
              <button onClick={() => startEdit(c)}
                className="text-xs px-3 py-1 rounded-md text-white" style={{ backgroundColor: '#C8788A' }}>
                Edit
              </button>
            </div>
          </div>
        ))}
        {!loading && cats.length === 0 && (
          <div className="text-center py-16 text-[#3D2E2E]/30 text-sm">No categories yet</div>
        )}
      </div>

      {(editing || adding) && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl">
            <h2 className="text-lg font-bold text-[#3D2E2E] mb-4">{adding ? 'New Category' : `Edit — ${editing?.name}`}</h2>
            <div className="space-y-4">
              {field('Name', 'name')}
              {field('Slug (auto-generated if blank)', 'slug')}
              {field('Icon (emoji or icon name)', 'icon_name')}
              <div>
                <label className="text-xs font-medium text-[#3D2E2E]/60 block mb-1">Colour hex</label>
                <div className="flex gap-2 items-center">
                  <input type="color" value={form.colour_hex ?? '#C8788A'}
                    onChange={e => setForm(f => ({ ...f, colour_hex: e.target.value }))}
                    className="w-10 h-9 border border-black/10 rounded-lg cursor-pointer" />
                  <input type="text" value={form.colour_hex ?? ''}
                    onChange={e => setForm(f => ({ ...f, colour_hex: e.target.value }))}
                    className="border border-black/10 rounded-lg px-3 py-2 text-sm flex-1" />
                </div>
              </div>
              {field('Sort order', 'sort_order', 'number')}
              <div className="flex items-center gap-3">
                <label className="text-xs font-medium text-[#3D2E2E]/60">Active</label>
                <input type="checkbox" checked={form.is_active}
                  onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))}
                  className="w-4 h-4" />
              </div>
            </div>
            <div className="flex gap-3 justify-end mt-6">
              <button onClick={() => { setEditing(null); setAdding(false) }} className="px-4 py-2 text-sm rounded-lg bg-gray-100 text-gray-600">Cancel</button>
              <button onClick={save} className="px-4 py-2 text-sm rounded-lg text-white font-medium" style={{ backgroundColor: '#8C4A58' }}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
