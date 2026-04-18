import { type CSSProperties, ChangeEvent, useEffect, useMemo, useRef, useState } from 'react'
import {
  User,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
} from 'firebase/auth'
import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore'
import {
  auth,
  db,
  firebaseConfigError,
  firebaseConfigReady,
  googleProvider,
} from './firebase'
import { getExerciseImages } from './exerciseMedia'

type Exercise = {
  name: string
  sets: number
  reps: string
  tip?: string
  day?: string
  duration?: string
}

type SetEntry = {
  weight: string
  reps: string
}

type ExerciseEntry = {
  setsData: SetEntry[]
  notes: string
  done: boolean
}

type WorkoutDay = {
  title: string
  duration: string
  exercises: Exercise[]
}

type Metrics = {
  weight: string
  waist: string
  sleep: string
  steps: string
  notes: string
  hipPain: string
  kneePain: string
}

type FreeEntryExercise = {
  name: string
  category: 'Core' | 'Recovery'
  sets: number
  reps: string
  tip?: string
}

type PersistedDataV2 = {
  version: 2
  week: number
  day: string
  history: Record<string, Record<string, ExerciseEntry>>
  weeklyMetrics: Record<number, Metrics>
  workoutTemplates: Record<string, WorkoutDay>
}

type LegacyData = Partial<Omit<PersistedDataV2, 'version'>>

type PreviewDevice = {
  id: string
  label: string
  width: number
  height: number
}

const STORAGE_KEY = 'hipsafe-fitness-tracker-v2'
const EXPORT_PREFIX = 'hipsafe-fitness-backup'
const DAY_ORDER = ['Mon', 'Tue', 'Wed', 'Thu', 'Sat'] as const
const MAIN_DAYS = ['Tue', 'Wed', 'Thu']
const TABS = ['Workout', '6-Pack', 'Hip Recovery', 'Weekly Review', 'History', 'Progress'] as const
const REMOTE_DOC_ID = 'primary'
const PREVIEW_DEVICES: PreviewDevice[] = [
  { id: 'desktop', label: 'Desktop', width: 1440, height: 1024 },
  { id: 'tablet', label: 'Tablet', width: 834, height: 1112 },
  { id: 'mobile', label: 'Mobile', width: 390, height: 844 },
]

const phaseByWeek: Record<number, string> = {
  1: 'Foundation',
  2: 'Foundation',
  3: 'Build',
  4: 'Build',
  5: 'Strength + Shape',
  6: 'Strength + Shape',
  7: 'Peak Recomp',
  8: 'Peak Recomp',
}

const weeklyGuidance: Record<string, string> = {
  Foundation: 'Use moderate weights. Leave 2–3 reps in reserve. Prioritise form and comfort.',
  Build: 'Increase load slightly or add 1–2 reps if form stays solid.',
  'Strength + Shape': 'Push heavier on the main lifts. Control the lowering phase.',
  'Peak Recomp': 'Heaviest safe weeks. Add a short finisher if energy and joints feel good.',
}

const baseWorkoutTemplates: Record<string, WorkoutDay> = {
  Mon: {
    title: 'Cardio + Core',
    duration: '30 mins',
    exercises: [
      { name: 'Rowing Machine', sets: 1, reps: '20 mins', tip: 'Steady pace' },
      { name: 'Dead Bug', sets: 2, reps: '10/side', tip: 'Slow and controlled' },
      { name: 'Plank', sets: 2, reps: '30–45 sec', tip: 'Neutral spine' },
    ],
  },
  Tue: {
    title: 'Upper Push',
    duration: '45–60 mins',
    exercises: [
      { name: 'Bench Press', sets: 4, reps: '6–8', tip: 'Feet planted' },
      { name: 'Incline Dumbbell Press', sets: 3, reps: '8–10', tip: 'Controlled press' },
      { name: 'Seated Shoulder Press', sets: 3, reps: '8', tip: 'No back arch' },
      { name: 'Cable Chest Fly', sets: 3, reps: '12', tip: 'Slow squeeze' },
      { name: 'Triceps Pushdown', sets: 3, reps: '12', tip: 'Elbows tucked' },
    ],
  },
  Wed: {
    title: 'Lower (Hip Safe)',
    duration: '45–60 mins',
    exercises: [
      { name: 'Leg Press', sets: 4, reps: '10', tip: 'Controlled depth' },
      { name: 'Romanian Deadlift', sets: 3, reps: '8', tip: 'Hip hinge' },
      { name: 'Hip Thrust / Glute Bridge', sets: 3, reps: '10', tip: 'Pause at top' },
      { name: 'Hamstring Curl', sets: 3, reps: '12', tip: 'Smooth tempo' },
      { name: 'Calf Raise', sets: 3, reps: '12', tip: 'Full range' },
      { name: 'Side-Lying Leg Raise', sets: 2, reps: '12/side', tip: 'Strict glute med form' },
    ],
  },
  Thu: {
    title: 'Upper Pull + Arms',
    duration: '45–60 mins',
    exercises: [
      { name: 'Lat Pulldown', sets: 4, reps: '8–10', tip: 'Chest up' },
      { name: 'Seated Cable Row', sets: 3, reps: '10', tip: 'No swinging' },
      { name: 'Face Pull', sets: 3, reps: '12', tip: 'Pull high' },
      { name: 'Dumbbell Curl', sets: 3, reps: '10', tip: 'Strict reps' },
      { name: 'Hammer Curl', sets: 3, reps: '10', tip: 'Control lowering' },
    ],
  },
  Sat: {
    title: 'Cardio + Mobility',
    duration: '30 mins',
    exercises: [
      { name: 'Rowing Machine / Incline Walk', sets: 1, reps: '20 mins', tip: 'Moderate pace' },
      { name: 'Hip Flexor Stretch', sets: 2, reps: '30 sec/side', tip: 'Pelvis tucked' },
      { name: 'Figure 4 Glute Stretch', sets: 2, reps: '30 sec/side', tip: 'Gentle only' },
    ],
  },
}

const coreRoutine: Exercise[] = [
  { name: 'Hanging Knee Raise', day: 'Mon / Thu / Sat', sets: 3, reps: '10–15', duration: '5 mins' },
  { name: 'Cable Crunch', day: 'Mon / Thu / Sat', sets: 3, reps: '12–15', duration: '5 mins' },
  { name: 'Ab Rollout', day: 'Tue / Thu', sets: 3, reps: '8–10', duration: '4 mins' },
  { name: 'Bicycle Crunch', day: 'Mon / Sat', sets: 2, reps: '20 total', duration: '3 mins' },
  { name: 'Plank', day: 'Mon / Thu / Sat', sets: 2, reps: '45–60 sec', duration: '3 mins' },
]

const hipRoutine: Exercise[] = [
  { name: 'Glute Bridge', day: 'Daily', sets: 2, reps: '12', duration: '2 mins' },
  { name: 'Side-Lying Leg Raise', day: 'Daily', sets: 2, reps: '12/side', duration: '2 mins' },
  { name: 'Banded Lateral Walk', day: 'Daily', sets: 2, reps: '10 steps each way', duration: '2 mins' },
  { name: 'Single-Leg RDL', day: 'Daily', sets: 2, reps: '8/side', duration: '2 mins' },
  { name: 'Hip Flexor Stretch', day: 'Daily', sets: 2, reps: '30 sec/side', duration: '2 mins' },
  { name: 'Figure 4 Glute Stretch', day: 'Daily', sets: 2, reps: '30 sec/side', duration: '2 mins' },
]

const FREE_ENTRY_EXERCISES: FreeEntryExercise[] = [
  { name: 'Hanging Knee Raise', category: 'Core', sets: 3, reps: '10–15', tip: 'Controlled lift' },
  { name: 'Cable Crunch', category: 'Core', sets: 3, reps: '12–15', tip: 'Round through abs' },
  { name: 'Ab Rollout', category: 'Core', sets: 3, reps: '8–10', tip: 'Keep ribs down' },
  { name: 'Bicycle Crunch', category: 'Core', sets: 2, reps: '20 total', tip: 'Slow twist' },
  { name: 'Dead Bug', category: 'Core', sets: 2, reps: '10/side', tip: 'Brace core' },
  { name: 'Plank', category: 'Core', sets: 2, reps: '30–60 sec', tip: 'Neutral spine' },
  { name: 'Glute Bridge', category: 'Recovery', sets: 2, reps: '12', tip: 'Squeeze glutes' },
  { name: 'Hip Thrust / Glute Bridge', category: 'Recovery', sets: 3, reps: '10', tip: 'Pause at top' },
  { name: 'Banded Lateral Walk', category: 'Recovery', sets: 2, reps: '10 steps each way', tip: 'Stay low' },
  { name: 'Side-Lying Leg Raise', category: 'Recovery', sets: 2, reps: '12/side', tip: 'Strict glute med form' },
  { name: 'Hip Flexor Stretch', category: 'Recovery', sets: 2, reps: '30 sec/side', tip: 'Pelvis tucked' },
  { name: 'Figure 4 Glute Stretch', category: 'Recovery', sets: 2, reps: '30 sec/side', tip: 'Gentle stretch' },
  { name: 'Single-Leg RDL', category: 'Recovery', sets: 2, reps: '8/side', tip: 'Balance and hinge' },
]

const defaultMetrics: Metrics = {
  weight: '83',
  waist: '',
  sleep: '6.5',
  steps: '',
  notes: '',
  hipPain: '',
  kneePain: '',
}

function getInitialSetEntries(count: number): SetEntry[] {
  return Array.from({ length: count }, () => ({ weight: '', reps: '' }))
}

function addExerciseToDay(
  templates: Record<string, WorkoutDay>,
  day: string,
  exerciseName: string,
): Record<string, WorkoutDay> {
  const template = templates[day]
  if (!template) return templates
  if (template.exercises.some((exercise) => exercise.name === exerciseName)) return templates

  const freeEntry = FREE_ENTRY_EXERCISES.find((exercise) => exercise.name === exerciseName)
  if (!freeEntry) return templates

  return {
    ...templates,
    [day]: {
      ...template,
      exercises: [
        ...template.exercises,
        { name: freeEntry.name, sets: freeEntry.sets, reps: freeEntry.reps, tip: freeEntry.tip },
      ],
    },
  }
}

function moveExerciseBetweenDays(
  templates: Record<string, WorkoutDay>,
  exerciseName: string,
  fromDay: string,
  toDay: string,
): Record<string, WorkoutDay> {
  if (fromDay === toDay) return templates
  const exercise = templates[fromDay]?.exercises.find((item) => item.name === exerciseName)
  if (!exercise || !templates[toDay]) return templates
  if (templates[toDay].exercises.some((item) => item.name === exerciseName)) return templates

  return {
    ...templates,
    [fromDay]: {
      ...templates[fromDay],
      exercises: templates[fromDay].exercises.filter((item) => item.name !== exerciseName),
    },
    [toDay]: {
      ...templates[toDay],
      exercises: [...templates[toDay].exercises, exercise],
    },
  }
}

function migratePersistedData(raw: unknown): PersistedDataV2 {
  const fallback: PersistedDataV2 = {
    version: 2,
    week: 1,
    day: 'Tue',
    history: {},
    weeklyMetrics: { 1: { ...defaultMetrics } },
    workoutTemplates: baseWorkoutTemplates,
  }

  if (!raw || typeof raw !== 'object') return fallback

  const data = raw as Partial<PersistedDataV2 & LegacyData>

  return {
    version: 2,
    week: typeof data.week === 'number' ? Math.min(8, Math.max(1, data.week)) : 1,
    day: typeof data.day === 'string' && DAY_ORDER.includes(data.day as (typeof DAY_ORDER)[number]) ? data.day : 'Tue',
    history: typeof data.history === 'object' && data.history ? data.history : {},
    weeklyMetrics: typeof data.weeklyMetrics === 'object' && data.weeklyMetrics ? data.weeklyMetrics : { 1: { ...defaultMetrics } },
    workoutTemplates: typeof data.workoutTemplates === 'object' && data.workoutTemplates ? data.workoutTemplates : baseWorkoutTemplates,
  }
}

function buildPayload(
  week: number,
  day: string,
  history: Record<string, Record<string, ExerciseEntry>>,
  weeklyMetrics: Record<number, Metrics>,
  workoutTemplates: Record<string, WorkoutDay>,
): PersistedDataV2 {
  return { version: 2, week, day, history, weeklyMetrics, workoutTemplates }
}

function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

function formatExportName() {
  const iso = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
  return `${EXPORT_PREFIX}-${iso}.json`
}

function getRemoteDocRef(user: User) {
  return doc(db, 'users', user.uid, 'trackerData', REMOTE_DOC_ID)
}

function ExerciseGallery({
  exerciseName,
  compact = false,
}: {
  exerciseName: string
  compact?: boolean
}) {
  const images = getExerciseImages(exerciseName)

  if (!images.length) return null

  return (
    <div className={`exercise-gallery${compact ? ' compact' : ''}`}>
      <div className="gallery-track" aria-label={`${exerciseName} image gallery`}>
        {images.map((image, index) => (
          <img
            key={`${exerciseName}-${index}`}
            className="gallery-image"
            src={image}
            alt={`${exerciseName} reference ${index + 1}`}
            loading="lazy"
            referrerPolicy="no-referrer"
          />
        ))}
      </div>
      <div className="gallery-meta">{images.length} reference image{images.length > 1 ? 's' : ''}</div>
    </div>
  )
}

function SimpleRoutineCard({ item }: { item: Exercise }) {
  return (
    <div className="card subtle routine-card">
      <ExerciseGallery exerciseName={item.name} compact />
      <div className="exercise-title">{item.name}</div>
      <div className="muted">Day: {item.day}</div>
      <div className="muted">Sets/Reps: {item.sets} × {item.reps}</div>
      <div className="muted">Duration: {item.duration}</div>
    </div>
  )
}

function ExerciseTrackerCard({
  exercise,
  entry,
  currentDay,
  onChange,
  onMoveExercise,
}: {
  exercise: Exercise
  entry: ExerciseEntry
  currentDay: string
  onChange: (value: ExerciseEntry) => void
  onMoveExercise: (exerciseName: string, toDay: string) => void
}) {
  const setsData = entry.setsData.length === exercise.sets ? entry.setsData : getInitialSetEntries(exercise.sets)

  return (
    <div className="card exercise-card">
      <ExerciseGallery exerciseName={exercise.name} />
      <div className="exercise-head">
        <div className="exercise-info">
          <div className="exercise-title">{exercise.name}</div>
          <div className="muted">{exercise.sets} sets · {exercise.reps}</div>
          {exercise.tip && <div className="muted small-gap">{exercise.tip}</div>}
        </div>
        <label className="move-label">
          Move day
          <select value={currentDay} onChange={(event) => onMoveExercise(exercise.name, event.target.value)}>
            {DAY_ORDER.map((dayOption) => <option key={dayOption} value={dayOption}>{dayOption}</option>)}
          </select>
        </label>
      </div>

      <div className="sets-grid">
        {setsData.map((setEntry, index) => (
          <div key={`${exercise.name}-${index}`} className="set-box">
            <strong>Set {index + 1}</strong>
            <label>
              Weight
              <input
                value={setEntry.weight}
                placeholder="kg"
                inputMode="decimal"
                onChange={(event) => {
                  const next = setsData.map((set, setIndex) => setIndex === index ? { ...set, weight: event.target.value } : set)
                  onChange({ ...entry, setsData: next })
                }}
              />
            </label>
            <label>
              Reps / time
              <input
                value={setEntry.reps}
                placeholder={exercise.reps}
                onChange={(event) => {
                  const next = setsData.map((set, setIndex) => setIndex === index ? { ...set, reps: event.target.value } : set)
                  onChange({ ...entry, setsData: next })
                }}
              />
            </label>
          </div>
        ))}
      </div>

      <div className="exercise-foot">
        <label className="grow">
          Notes
          <input
            value={entry.notes}
            placeholder="Strong, pain, tough..."
            onChange={(event) => onChange({ ...entry, setsData, notes: event.target.value })}
          />
        </label>
        <label className="checkbox-line">
          <input
            type="checkbox"
            checked={entry.done}
            onChange={(event) => onChange({ ...entry, setsData, done: event.target.checked })}
          />
          Done
        </label>
      </div>
    </div>
  )
}

function PreviewPortal() {
  return (
    <div className="preview-shell">
      <header className="preview-header card">
        <div>
          <p className="eyebrow">Local Preview Portal</p>
          <h1>Desktop, Tablet and Mobile</h1>
          <p className="hero-copy">Use this page during `npm run dev` to review the same app in three viewport classes before deploying.</p>
        </div>
        <div className="hero-actions">
          <a className="portal-link" href="./">Open main app</a>
          <a className="portal-link" href="./?preview=1">Refresh portal</a>
        </div>
      </header>

      <section className="preview-grid">
        {PREVIEW_DEVICES.map((device) => (
          <article key={device.id} className="card preview-card">
            <div className="preview-card-head">
              <div>
                <div className="exercise-title">{device.label}</div>
                <div className="muted">{device.width} × {device.height}</div>
              </div>
              <a className="portal-link secondary-link" href={`./?embedded=1&device=${device.id}`}>Open alone</a>
            </div>
            <div
              className={`device-shell device-${device.id}`}
              style={
                {
                  '--device-width': `${device.width}px`,
                  '--device-height': `${device.height}px`,
                } as CSSProperties
              }
            >
              <iframe
                className="device-frame"
                src={`./?embedded=1&device=${device.id}`}
                title={`${device.label} preview`}
              />
            </div>
          </article>
        ))}
      </section>
    </div>
  )
}

function TrackerApp({
  embedded,
  device,
}: {
  embedded: boolean
  device: string | null
}) {
  const loadedRef = useRef(false)
  const remoteReadyRef = useRef(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const syncTimerRef = useRef<number | null>(null)

  const [activeTab, setActiveTab] = useState<(typeof TABS)[number]>('Workout')
  const [showAddExercise, setShowAddExercise] = useState(false)
  const [addFilter, setAddFilter] = useState<'All' | 'Core' | 'Recovery'>('All')
  const [week, setWeek] = useState(1)
  const [day, setDay] = useState('Tue')
  const [history, setHistory] = useState<Record<string, Record<string, ExerciseEntry>>>({})
  const [weeklyMetrics, setWeeklyMetrics] = useState<Record<number, Metrics>>({ 1: { ...defaultMetrics } })
  const [workoutTemplates, setWorkoutTemplates] = useState<Record<string, WorkoutDay>>(baseWorkoutTemplates)
  const [status, setStatus] = useState('Autosave ready')
  const [syncStatus, setSyncStatus] = useState(
    firebaseConfigReady ? 'Remote sync not connected' : 'Firebase config missing',
  )
  const [user, setUser] = useState<User | null>(null)
  const [authLoading, setAuthLoading] = useState(firebaseConfigReady)
  const [remoteSyncEnabled, setRemoteSyncEnabled] = useState(false)

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (!stored) {
      loadedRef.current = true
      return
    }

    try {
      const parsed = JSON.parse(stored)
      const migrated = migratePersistedData(parsed)
      setWeek(migrated.week)
      setDay(migrated.day)
      setHistory(migrated.history)
      setWeeklyMetrics(migrated.weeklyMetrics)
      setWorkoutTemplates(migrated.workoutTemplates)
      setStatus('Saved local data loaded')
    } catch {
      setStatus('Saved local data could not be read. Starting fresh.')
    } finally {
      loadedRef.current = true
    }
  }, [])

  useEffect(() => {
    if (!loadedRef.current) return
    const payload = buildPayload(week, day, history, weeklyMetrics, workoutTemplates)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
    setStatus(`Local autosaved ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`)
  }, [week, day, history, weeklyMetrics, workoutTemplates])

  useEffect(() => {
    if (!firebaseConfigReady) {
      setAuthLoading(false)
      setRemoteSyncEnabled(false)
      setSyncStatus('Firebase config missing')
      return
    }

    const unsubscribe = onAuthStateChanged(auth, async (nextUser) => {
      setUser(nextUser)
      setAuthLoading(false)
      remoteReadyRef.current = false

      if (!nextUser) {
        setRemoteSyncEnabled(false)
        setSyncStatus('Remote sync not connected')
        return
      }

      setSyncStatus('Checking remote data…')
      const payload = buildPayload(week, day, history, weeklyMetrics, workoutTemplates)

      try {
        const snapshot = await getDoc(getRemoteDocRef(nextUser))
        if (snapshot.exists()) {
          const remoteData = migratePersistedData(snapshot.data())
          setWeek(remoteData.week)
          setDay(remoteData.day)
          setHistory(remoteData.history)
          setWeeklyMetrics(remoteData.weeklyMetrics)
          setWorkoutTemplates(remoteData.workoutTemplates)
          setSyncStatus('Remote data loaded')
          setStatus('Remote data is now active on this device')
        } else {
          await setDoc(getRemoteDocRef(nextUser), {
            ...payload,
            updatedAt: serverTimestamp(),
            updatedBy: nextUser.email || nextUser.uid,
          })
          setSyncStatus('Remote profile created from local data')
        }
        setRemoteSyncEnabled(true)
      } catch (error) {
        console.error(error)
        setRemoteSyncEnabled(false)
        setSyncStatus('Remote sync failed to start. Local data is still safe on this device.')
      } finally {
        remoteReadyRef.current = true
      }
    })

    return () => unsubscribe()
  }, [])

  useEffect(() => {
    if (!loadedRef.current || !remoteReadyRef.current || !remoteSyncEnabled || !user || !firebaseConfigReady) return

    if (syncTimerRef.current) {
      window.clearTimeout(syncTimerRef.current)
    }

    syncTimerRef.current = window.setTimeout(async () => {
      try {
        const payload = buildPayload(week, day, history, weeklyMetrics, workoutTemplates)
        setSyncStatus('Syncing to Firebase…')
        await setDoc(getRemoteDocRef(user), {
          ...payload,
          updatedAt: serverTimestamp(),
          updatedBy: user.email || user.uid,
        })
        setSyncStatus(`Firebase synced ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`)
      } catch (error) {
        console.error(error)
        setSyncStatus('Firebase sync failed. Your local device copy is still saved.')
      }
    }, 1200)

    return () => {
      if (syncTimerRef.current) {
        window.clearTimeout(syncTimerRef.current)
      }
    }
  }, [day, history, remoteSyncEnabled, user, week, weeklyMetrics, workoutTemplates])

  const phase = phaseByWeek[week]
  const workout = workoutTemplates[day]
  const workoutKey = `week-${week}-${day}`
  const workoutEntries = history[workoutKey] || {}
  const metrics = weeklyMetrics[week] || defaultMetrics

  const setWorkoutEntry = (exerciseName: string, value: ExerciseEntry) => {
    setHistory((previous) => ({
      ...previous,
      [workoutKey]: {
        ...(previous[workoutKey] || {}),
        [exerciseName]: value,
      },
    }))
  }

  const setMetrics = (patch: Partial<Metrics>) => {
    setWeeklyMetrics((previous) => ({
      ...previous,
      [week]: {
        ...(previous[week] || { ...defaultMetrics }),
        ...patch,
      },
    }))
  }

  const todayProgress = useMemo(() => {
    const total = workout.exercises.length
    const done = Object.values(workoutEntries).filter((entry) => entry?.done).length
    return total ? Math.round((done / total) * 100) : 0
  }, [workout, workoutEntries])

  const weeklyCompletion = useMemo(() => {
    const completed = MAIN_DAYS.filter((mainDay) => Object.values(history[`week-${week}-${mainDay}`] || {}).some((entry) => entry?.done)).length
    return Math.round((completed / MAIN_DAYS.length) * 100)
  }, [history, week])

  const allWeeksSummary = useMemo(() => {
    return Array.from({ length: 8 }, (_, index) => index + 1).map((weekNumber) => {
      const sessionsDone = MAIN_DAYS.filter((mainDay) => Object.values(history[`week-${weekNumber}-${mainDay}`] || {}).some((entry) => entry?.done)).length
      const weekMetrics = weeklyMetrics[weekNumber] || defaultMetrics
      return {
        week: weekNumber,
        phase: phaseByWeek[weekNumber],
        sessionsDone,
        ...weekMetrics,
      }
    })
  }, [history, weeklyMetrics])

  const bestBench = useMemo(() => {
    let best = 0
    Object.values(history).forEach((session) => {
      const bench = session['Bench Press']
      bench?.setsData?.forEach((set) => {
        const weight = parseFloat(set.weight)
        if (!Number.isNaN(weight) && weight > best) best = weight
      })
    })
    return best || '-'
  }, [history])

  const availableFreeExercises = FREE_ENTRY_EXERCISES.filter((item) => {
    const categoryMatch = addFilter === 'All' || item.category === addFilter
    const alreadyOnDay = workout.exercises.some((exercise) => exercise.name === item.name)
    return categoryMatch && !alreadyOnDay
  })

  const handleExport = () => {
    const payload = buildPayload(week, day, history, weeklyMetrics, workoutTemplates)
    downloadJson(formatExportName(), payload)
    setStatus('Backup exported')
  }

  const handleImportClick = () => fileInputRef.current?.click()

  const handleImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    try {
      const text = await file.text()
      const parsed = JSON.parse(text)
      const migrated = migratePersistedData(parsed)
      setWeek(migrated.week)
      setDay(migrated.day)
      setHistory(migrated.history)
      setWeeklyMetrics(migrated.weeklyMetrics)
      setWorkoutTemplates(migrated.workoutTemplates)
      setStatus('Backup imported successfully')
    } catch {
      setStatus('Import failed. Please choose a valid backup JSON file.')
    } finally {
      event.target.value = ''
    }
  }

  const handleReset = () => {
    const confirmed = window.confirm('Reset all local data on this device? Export a backup first if needed.')
    if (!confirmed) return
    localStorage.removeItem(STORAGE_KEY)
    setWeek(1)
    setDay('Tue')
    setHistory({})
    setWeeklyMetrics({ 1: { ...defaultMetrics } })
    setWorkoutTemplates(baseWorkoutTemplates)
    setStatus('Local data reset')
  }

  const handleGoogleSignIn = async () => {
    if (!firebaseConfigReady) {
      setSyncStatus('Firebase config missing. Create a local .env file first.')
      return
    }

    try {
      setSyncStatus('Opening Google sign-in…')
      await signInWithPopup(auth, googleProvider)
    } catch (error) {
      const code = (error as { code?: string }).code
      console.error(error)
      if (code === 'auth/popup-closed-by-user') {
        setSyncStatus('Google sign-in was closed before completion')
        return
      }
      if (code === 'auth/unauthorized-domain') {
        setSyncStatus('This domain is not authorised in Firebase yet. Add it in Firebase Auth settings.')
        return
      }
      setSyncStatus('Google sign-in failed. Check Firebase Auth settings and authorised domains.')
    }
  }

  const handleSignOut = async () => {
    await signOut(auth)
    setSyncStatus('Signed out. Local device data remains available.')
  }

  const handleForceRemoteSave = async () => {
    if (!user || !firebaseConfigReady) return
    try {
      const payload = buildPayload(week, day, history, weeklyMetrics, workoutTemplates)
      await setDoc(getRemoteDocRef(user), {
        ...payload,
        updatedAt: serverTimestamp(),
        updatedBy: user.email || user.uid,
      })
      setSyncStatus('Manual Firebase save complete')
    } catch (error) {
      console.error(error)
      setSyncStatus('Manual remote save failed. Local copy is still intact.')
    }
  }

  const appShellClassName = `app-shell${embedded ? ' embedded-shell' : ''}${device ? ` device-${device}` : ''}`

  return (
    <div className={appShellClassName}>
      {!firebaseConfigReady && !embedded && (
        <section className="warning-banner card">
          <strong>Firebase setup missing</strong>
          <p className="muted">{firebaseConfigError}</p>
        </section>
      )}

      {!embedded && (
        <header className="hero card">
          <div>
            <p className="eyebrow">Installable PWA · Exercise galleries · Firebase sync</p>
            <h1>8-Week Lean + Muscular Tracker</h1>
            <p className="hero-copy">Training, core, hip recovery, review notes, history, and progress in one place across your devices.</p>
            <div className="badge-row wrap">
              <span className="badge">Week {week}</span>
              <span className="badge secondary">{phase}</span>
              <span className="badge secondary">{status}</span>
              <span className="badge secondary">{syncStatus}</span>
            </div>
            <p className="muted top-gap">{weeklyGuidance[phase]}</p>
          </div>
          <div className="hero-actions">
            <button onClick={() => setWeek((value) => Math.max(1, value - 1))}>Prev Week</button>
            <button onClick={() => setWeek((value) => Math.min(8, value + 1))}>Next Week</button>
            <a className="portal-link" href="./?preview=1">Open Preview Portal</a>
          </div>
        </header>
      )}

      <section className="card section-card">
        <div className="section-head">
          <div>
            <h2>Account & Sync</h2>
            <p className="muted">One Google account, local backup on every device, and Firebase remote sync for cross-device access.</p>
          </div>
          <div className="button-row wrap">
            {authLoading ? (
              <span className="muted">Checking sign-in…</span>
            ) : user ? (
              <>
                <span className="badge">{user.email || 'Signed in'}</span>
                <button onClick={handleForceRemoteSave}>Save to cloud now</button>
                <button onClick={handleSignOut}>Sign out</button>
              </>
            ) : (
              <button onClick={handleGoogleSignIn}>Sign in with Google</button>
            )}
          </div>
        </div>
        <div className="summary-grid top-gap">
          <div><span className="muted">Local safety copy:</span> always on</div>
          <div><span className="muted">Remote sync:</span> {firebaseConfigReady ? (user ? 'connected when signed in' : 'sign in required') : 'env setup required'}</div>
          <div><span className="muted">Conflict mode:</span> last saved copy wins</div>
          <div><span className="muted">Backup file:</span> export/import available</div>
          <div><span className="muted">Account type:</span> single Google account</div>
          <div><span className="muted">Hosting target:</span> Firebase Hosting</div>
        </div>
      </section>

      <section className="top-grid">
        <div className="card stat-card">
          <div className="stat-label">Today</div>
          <div className="stat-value">{todayProgress}%</div>
          <progress max={100} value={todayProgress} />
        </div>
        <div className="card stat-card">
          <div className="stat-label">Main sessions</div>
          <div className="stat-value">{weeklyCompletion}%</div>
          <progress max={100} value={weeklyCompletion} />
        </div>
        <div className="card stat-card">
          <div className="stat-label">Best bench</div>
          <div className="stat-value">{bestBench === '-' ? '-' : `${bestBench} kg`}</div>
        </div>
        <div className="card stat-card">
          <div className="stat-label">Hip pain this week</div>
          <div className="stat-value">{metrics.hipPain || '-'}</div>
        </div>
      </section>

      <section className="card controls-card">
        <div className="button-row wrap scroll-row">
          {TABS.map((tab) => (
            <button key={tab} className={activeTab === tab ? 'active' : ''} onClick={() => setActiveTab(tab)}>{tab}</button>
          ))}
        </div>
        <div className="button-row wrap top-gap">
          <button onClick={handleExport}>Export backup</button>
          <button onClick={handleImportClick}>Import backup</button>
          <button className="danger" onClick={handleReset}>Reset local data</button>
          <input ref={fileInputRef} type="file" accept="application/json" hidden onChange={handleImport} />
        </div>
      </section>

      {activeTab === 'Workout' && (
        <section className="card section-card">
          <div className="section-head">
            <div>
              <h2>Session Planner</h2>
              <p className="muted">Choose your training day and log every set.</p>
            </div>
            <div className="button-row wrap scroll-row">
              {Object.keys(workoutTemplates).map((dayOption) => (
                <button key={dayOption} className={day === dayOption ? 'active' : ''} onClick={() => setDay(dayOption)}>{dayOption}</button>
              ))}
            </div>
          </div>

          <div className="button-row wrap top-gap">
            <button onClick={() => setShowAddExercise((value) => !value)}>{showAddExercise ? 'Hide add-ons' : 'Add core / recovery'}</button>
            {showAddExercise && (
              <select value={addFilter} onChange={(event) => setAddFilter(event.target.value as 'All' | 'Core' | 'Recovery')}>
                <option value="All">All</option>
                <option value="Core">Core</option>
                <option value="Recovery">Recovery</option>
              </select>
            )}
          </div>

          {showAddExercise && (
            <div className="card subtle add-panel">
              <strong>Add optional exercises to {day}</strong>
              <div className="button-row wrap top-gap">
                {availableFreeExercises.length > 0 ? availableFreeExercises.map((item) => (
                  <button key={item.name} onClick={() => setWorkoutTemplates((previous) => addExerciseToDay(previous, day, item.name))}>+ {item.name}</button>
                )) : <span className="muted">No more matching add-ons for this day.</span>}
              </div>
            </div>
          )}

          <div className="card subtle session-summary">
            <h3>{workout.title}</h3>
            <p className="muted">Duration: {workout.duration}</p>
          </div>

          <div className="stack">
            {workout.exercises.map((exercise) => (
              <ExerciseTrackerCard
                key={exercise.name}
                exercise={exercise}
                currentDay={day}
                entry={workoutEntries[exercise.name] || { setsData: getInitialSetEntries(exercise.sets), notes: '', done: false }}
                onChange={(value) => setWorkoutEntry(exercise.name, value)}
                onMoveExercise={(exerciseName, toDay) => {
                  setWorkoutTemplates((previous) => moveExerciseBetweenDays(previous, exerciseName, day, toDay))
                  if (day !== toDay) setDay(toDay)
                }}
              />
            ))}
          </div>
        </section>
      )}

      {activeTab === '6-Pack' && <section className="stack">{coreRoutine.map((item) => <SimpleRoutineCard key={item.name} item={item} />)}</section>}
      {activeTab === 'Hip Recovery' && <section className="stack">{hipRoutine.map((item) => <SimpleRoutineCard key={item.name} item={item} />)}</section>}

      {activeTab === 'Weekly Review' && (
        <section className="review-grid">
          <div className="card section-card">
            <h2>Weekly Check-In</h2>
            <div className="form-grid">
              <label>Weight (kg)<input value={metrics.weight} inputMode="decimal" onChange={(event) => setMetrics({ weight: event.target.value })} /></label>
              <label>Waist (cm)<input value={metrics.waist} inputMode="decimal" onChange={(event) => setMetrics({ waist: event.target.value })} /></label>
              <label>Average sleep (hours)<input value={metrics.sleep} inputMode="decimal" onChange={(event) => setMetrics({ sleep: event.target.value })} /></label>
              <label>Average steps/day<input value={metrics.steps} inputMode="numeric" onChange={(event) => setMetrics({ steps: event.target.value })} /></label>
              <label>Hip pain (0–10)<input value={metrics.hipPain} inputMode="numeric" onChange={(event) => setMetrics({ hipPain: event.target.value })} /></label>
              <label>Knee pain (0–10)<input value={metrics.kneePain} inputMode="numeric" onChange={(event) => setMetrics({ kneePain: event.target.value })} /></label>
            </div>
          </div>
          <div className="card section-card">
            <h2>Review Notes</h2>
            <label>
              Notes
              <textarea rows={14} value={metrics.notes} onChange={(event) => setMetrics({ notes: event.target.value })} placeholder="Week review: energy, diet, best lift, pain triggers, what to change next week..." />
            </label>
          </div>
        </section>
      )}

      {activeTab === 'History' && (
        <section className="stack">
          {allWeeksSummary.map((row) => (
            <div key={row.week} className="card subtle">
              <div className="badge-row wrap">
                <span className="badge">Week {row.week}</span>
                <span className="badge secondary">{row.phase}</span>
              </div>
              <div className="summary-grid top-gap">
                <div><span className="muted">Main sessions:</span> {row.sessionsDone}/3</div>
                <div><span className="muted">Weight:</span> {row.weight || '-'}</div>
                <div><span className="muted">Waist:</span> {row.waist || '-'}</div>
                <div><span className="muted">Sleep:</span> {row.sleep || '-'}</div>
                <div><span className="muted">Hip pain:</span> {row.hipPain || '-'}</div>
                <div><span className="muted">Knee pain:</span> {row.kneePain || '-'}</div>
              </div>
            </div>
          ))}
        </section>
      )}

      {activeTab === 'Progress' && (
        <section className="stack">
          <div className="top-grid">
            <div className="card stat-card"><div className="stat-label">Current week</div><div className="stat-value">{week}</div></div>
            <div className="card stat-card"><div className="stat-label">Main completion</div><div className="stat-value">{weeklyCompletion}%</div></div>
            <div className="card stat-card"><div className="stat-label">Best bench</div><div className="stat-value">{bestBench === '-' ? '-' : `${bestBench}kg`}</div></div>
            <div className="card stat-card"><div className="stat-label">Hip pain</div><div className="stat-value">{metrics.hipPain || '-'}</div></div>
          </div>
          <div className="card section-card">
            <h2>Trend Summary</h2>
            <div className="stack">
              <div className="card subtle">Weight trend: {allWeeksSummary.filter((row) => row.weight).map((row) => `W${row.week}: ${row.weight}kg`).join(' • ') || 'No entries yet'}</div>
              <div className="card subtle">Waist trend: {allWeeksSummary.filter((row) => row.waist).map((row) => `W${row.week}: ${row.waist}cm`).join(' • ') || 'No entries yet'}</div>
              <div className="card subtle">Hip pain trend: {allWeeksSummary.filter((row) => row.hipPain).map((row) => `W${row.week}: ${row.hipPain}/10`).join(' • ') || 'No entries yet'}</div>
              <div className="card subtle">Sessions completed: {allWeeksSummary.map((row) => `W${row.week}: ${row.sessionsDone}/3`).join(' • ')}</div>
            </div>
          </div>
        </section>
      )}
    </div>
  )
}

export default function App() {
  const searchParams = new URLSearchParams(window.location.search)
  const previewMode = searchParams.get('preview') === '1'
  const embedded = searchParams.get('embedded') === '1'
  const device = searchParams.get('device')

  if (previewMode) {
    return <PreviewPortal />
  }

  return <TrackerApp embedded={embedded} device={device} />
}
