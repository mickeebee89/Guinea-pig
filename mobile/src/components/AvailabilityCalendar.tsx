import { useState, useMemo } from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import * as Haptics from 'expo-haptics'
import { Ionicons } from '@expo/vector-icons'
import { Colors, Fonts } from '@/constants/Colors'

// ── Constants ─────────────────────────────────────────────────────────────────

const DAYS_SHORT  = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
]

// ── Helpers ───────────────────────────────────────────────────────────────────

export function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function todayDateKey(): string {
  return dateKey(new Date())
}

function calendarRows(year: number, month: number): (Date | null)[][] {
  const startDow  = (new Date(year, month, 1).getDay() + 6) % 7
  const totalDays = new Date(year, month + 1, 0).getDate()
  const cells: (Date | null)[] = [
    ...Array<null>(startDow).fill(null),
    ...Array.from({ length: totalDays }, (_, i) => new Date(year, month, i + 1)),
  ]
  while (cells.length % 7 !== 0) cells.push(null)
  return Array.from({ length: cells.length / 7 }, (_, i) => cells.slice(i * 7, i * 7 + 7))
}

// ── Component ─────────────────────────────────────────────────────────────────

type Props = {
  availableDates: Set<string>
  todayKey: string
  selectedDate?: string | null
  onSelectDate?: (key: string) => void
}

export default function AvailabilityCalendar({ availableDates, todayKey, selectedDate, onSelectDate }: Props) {
  const now = new Date()
  const [viewYear,  setViewYear]  = useState(now.getFullYear())
  const [viewMonth, setViewMonth] = useState(now.getMonth())

  const calRows = useMemo(() => calendarRows(viewYear, viewMonth), [viewYear, viewMonth])

  const prevMonth = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1) }
    else setViewMonth(m => m - 1)
  }

  const nextMonth = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1) }
    else setViewMonth(m => m + 1)
  }

  const handleDayPress = async (key: string) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    onSelectDate?.(key)
  }

  const interactive = !!onSelectDate

  return (
    <View>
      {/* Month nav */}
      <View style={st.monthNav}>
        <TouchableOpacity style={st.monthNavBtn} onPress={prevMonth} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={18} color={Colors.warmDark} />
        </TouchableOpacity>
        <Text style={st.monthTitle}>{MONTH_NAMES[viewMonth]} {viewYear}</Text>
        <TouchableOpacity style={st.monthNavBtn} onPress={nextMonth} activeOpacity={0.7}>
          <Ionicons name="chevron-forward" size={18} color={Colors.warmDark} />
        </TouchableOpacity>
      </View>

      {/* Day headers */}
      <View style={st.calHeaders}>
        {DAYS_SHORT.map(d => (
          <Text key={d} style={st.calHeader}>{d}</Text>
        ))}
      </View>

      {/* Date grid */}
      {calRows.map((row, ri) => (
        <View key={ri} style={st.calRow}>
          {row.map((date, ci) => {
            if (!date) return <View key={ci} style={st.calCell} />
            const key        = dateKey(date)
            const isPast     = key < todayKey
            const isAvail    = availableDates.has(key) && !isPast
            const isSelected = key === selectedDate
            const isToday    = key === todayKey
            return (
              <TouchableOpacity
                key={ci}
                style={[
                  st.calCell,
                  isToday    && !isSelected && st.calCellToday,
                  isAvail    && !isSelected && st.calCellAvail,
                  isSelected && st.calCellSelected,
                  isPast     && st.calCellPast,
                ]}
                onPress={() => isAvail && handleDayPress(key)}
                disabled={isPast || !isAvail}
                activeOpacity={0.75}
              >
                <Text style={[
                  st.calCellText,
                  isToday    && !isSelected && st.calCellTextToday,
                  isAvail    && !isSelected && st.calCellTextAvail,
                  isSelected && st.calCellTextSelected,
                  isPast     && st.calCellTextPast,
                ]}>
                  {date.getDate()}
                </Text>
              </TouchableOpacity>
            )
          })}
        </View>
      ))}

      {/* Legend */}
      <View style={st.legendRow}>
        <View style={st.legendItem}>
          <View style={[st.legendDot, { backgroundColor: Colors.rose + '55' }]} />
          <Text style={st.legendText}>Available</Text>
        </View>
        {interactive && (
          <View style={st.legendItem}>
            <View style={[st.legendDot, { backgroundColor: Colors.roseDark }]} />
            <Text style={st.legendText}>Selected</Text>
          </View>
        )}
      </View>
    </View>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const st = StyleSheet.create({
  monthNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  monthNavBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: Colors.inputBg,
    alignItems: 'center', justifyContent: 'center',
  },
  monthTitle: { fontSize: 16, fontFamily: Fonts.heading, color: Colors.warmDark },
  calHeaders: { flexDirection: 'row', marginBottom: 6 },
  calHeader: {
    flex: 1, textAlign: 'center', fontSize: 11,
    fontFamily: Fonts.bodyBold, color: Colors.muted, textTransform: 'uppercase',
  },
  calRow: { flexDirection: 'row', marginBottom: 4 },
  calCell: { flex: 1, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 20 },
  calCellToday:    { borderWidth: 1.5, borderColor: Colors.rose },
  calCellAvail:    { backgroundColor: Colors.rose + '28' },
  calCellSelected: { backgroundColor: Colors.roseDark },
  calCellPast:     { opacity: 0.3 },
  calCellText:         { fontSize: 14, fontFamily: Fonts.body, color: Colors.warmDark },
  calCellTextToday:    { color: Colors.roseDark, fontFamily: Fonts.bodyBold },
  calCellTextAvail:    { color: Colors.roseDark, fontFamily: Fonts.bodyBold },
  calCellTextSelected: { color: Colors.white, fontFamily: Fonts.bodyBold },
  calCellTextPast:     { color: Colors.muted },
  legendRow: {
    flexDirection: 'row', gap: 16, marginTop: 12,
    paddingTop: 12, borderTopWidth: 1, borderTopColor: Colors.border,
  },
  legendItem:  { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot:   { width: 12, height: 12, borderRadius: 6 },
  legendText:  { fontSize: 12, color: Colors.muted, fontFamily: Fonts.body },
})
