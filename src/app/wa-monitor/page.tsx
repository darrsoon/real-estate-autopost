"use client";

import { useEffect, useState } from 'react';

interface Instance {
  id: string;
  token: string;
  name: string;
  tgMentions: string;
}

export default function WaMonitorPage() {
  const [triggers, setTriggers] = useState<string[]>([]);
  const [instances, setInstances] = useState<Instance[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [newTrigger, setNewTrigger] = useState('');
  const [newInstance, setNewInstance] = useState<Instance>({ id: '', token: '', name: '', tgMentions: '' });
  const [remindDelayMinutes, setRemindDelayMinutes] = useState(2880);

  useEffect(() => {
    fetch('/api/wa-monitor/config')
      .then(r => r.json())
      .then(d => {
        setTriggers(d.triggers || []);
        setInstances(d.instances || []);
        if (typeof d.remindDelayMinutes === 'number') setRemindDelayMinutes(d.remindDelayMinutes);
      })
      .finally(() => setLoading(false));
  }, []);

  const save = async () => {
    setSaving(true);
    setSaved(false);

    // Pick up a word typed in the box but not yet added via "Добавить"
    const pendingTrigger = newTrigger.trim().toLowerCase();
    const triggersToSave = pendingTrigger && !triggers.includes(pendingTrigger)
      ? [...triggers, pendingTrigger]
      : triggers;
    // Pick up an instance typed but not yet added
    const instancesToSave = newInstance.id.trim()
      ? [...instances, { ...newInstance }]
      : instances;

    if (triggersToSave !== triggers) setTriggers(triggersToSave);
    if (instancesToSave !== instances) { setInstances(instancesToSave); setNewInstance({ id: '', token: '', name: '', tgMentions: '' }); }
    setNewTrigger('');

    await fetch('/api/wa-monitor/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ triggers: triggersToSave, instances: instancesToSave, remindDelayMinutes })
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const addTrigger = () => {
    const t = newTrigger.trim().toLowerCase();
    if (t && !triggers.includes(t)) setTriggers([...triggers, t]);
    setNewTrigger('');
  };

  const removeTrigger = (i: number) => setTriggers(triggers.filter((_, idx) => idx !== i));

  const addInstance = () => {
    if (newInstance.id.trim()) {
      setInstances([...instances, { ...newInstance }]);
      setNewInstance({ id: '', token: '', name: '', tgMentions: '' });
    }
  };

  const removeInstance = (i: number) => setInstances(instances.filter((_, idx) => idx !== i));

  if (loading) return <div className="p-8 bb-ink">Загрузка...</div>;

  return (
    <div className="max-w-2xl mx-auto w-full space-y-2">
      <div className="mb-5">
        <h1 className="bb-title text-[34px] leading-tight mb-1">WA Монитор</h1>
        <p className="bb-sub text-sm">Напоминания о запросах брокеров.</p>
      </div>

      {/* Trigger words */}
      <section className="bb-card p-4 sm:p-6 mb-4">
        <h2 className="bb-title text-[17px] mb-1">Триггерные слова</h2>
        <p className="text-sm bb-ink-3 mb-4">
          Когда ты делаешь Reply на сообщение брокера и пишешь одно из этих слов — запрос сохраняется.
        </p>

        <div className="flex flex-wrap gap-2 mb-4">
          {triggers.map((t, i) => (
            <span key={i} className="bb-chip bb-chip-sky">
              {t}
              <button onClick={() => removeTrigger(i)} className="bb-ink-4 hover:bb-bad ml-1 leading-none">×</button>
            </span>
          ))}
          {triggers.length === 0 && <span className="bb-ink-4 text-sm">Нет триггеров</span>}
        </div>

        <div className="flex gap-2">
          <input
            value={newTrigger}
            onChange={e => setNewTrigger(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addTrigger()}
            placeholder="Новое слово..."
            className="bb-input flex-1 text-sm"
          />
          <button onClick={addTrigger} className="bb-btn bb-btn-ghost py-2">
            Добавить
          </button>
        </div>
      </section>

      {/* Reminder delay */}
      <section className="bb-card p-4 sm:p-6 mb-4">
        <h2 className="bb-title text-[17px] mb-1">Через сколько напоминать</h2>
        <p className="text-sm bb-ink-3 mb-4">
          Сколько ждать после запроса брокера, прежде чем прислать напоминание в Telegram.
        </p>
        <div className="flex flex-wrap gap-2">
          {[
            { label: '5 минут (тест)', value: 5 },
            { label: '1 день', value: 1440 },
            { label: '2 дня', value: 2880 },
            { label: '3 дня', value: 4320 },
          ].map(opt => (
            <button
              key={opt.value}
              onClick={() => setRemindDelayMinutes(opt.value)}
              className={`px-4 py-2 rounded-full text-sm font-bold transition-all active:scale-[.96] ${
                remindDelayMinutes === opt.value
                  ? 'bb-tint-accent'
                  : 'bb-surface-soft bb-ink-2 hover:brightness-95'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </section>

      {/* Instances */}
      <section className="bb-card p-4 sm:p-6 mb-4">
        <h2 className="bb-title text-[17px] mb-1">Green API инстансы</h2>
        <p className="text-sm bb-ink-3 mb-4">
          Каждый инстанс = один WhatsApp номер. Добавь свой и коллеги.
        </p>

        <div className="space-y-2 mb-4">
          {instances.map((inst, i) => (
            <div key={i} className="flex items-center gap-3 bb-surface-soft rounded-2xl px-4 py-2.5">
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm">{inst.name || 'Без имени'}{inst.tgMentions ? <span className="bb-accent font-normal"> · {inst.tgMentions}</span> : null}</div>
                <div className="text-xs bb-ink-4">ID: {inst.id} · Token: {inst.token.slice(0, 8)}...</div>
              </div>
              <button onClick={() => removeInstance(i)} className="bb-bad text-sm font-bold shrink-0 hover:brightness-90">
                Удалить
              </button>
            </div>
          ))}
          {instances.length === 0 && <p className="bb-ink-4 text-sm">Нет инстансов</p>}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-2">
          <input
            value={newInstance.name}
            onChange={e => setNewInstance({ ...newInstance, name: e.target.value })}
            placeholder="Имя (Наташа)"
            className="bb-input text-sm"
          />
          <input
            value={newInstance.tgMentions}
            onChange={e => setNewInstance({ ...newInstance, tgMentions: e.target.value })}
            placeholder="Теги TG (@user1 @user2)"
            className="bb-input text-sm"
          />
          <input
            value={newInstance.id}
            onChange={e => setNewInstance({ ...newInstance, id: e.target.value })}
            placeholder="Instance ID"
            className="bb-input text-sm"
          />
          <input
            value={newInstance.token}
            onChange={e => setNewInstance({ ...newInstance, token: e.target.value })}
            placeholder="API Token"
            className="bb-input text-sm"
          />
        </div>
        <button onClick={addInstance} className="bb-btn bb-btn-ghost w-full">
          Добавить инстанс
        </button>

        <p className="text-xs bb-ink-4 mt-3">
          После добавления инстанса нужно поставить вебхук в Green API консоли:<br />
          <span className="font-mono bb-ink-3 break-all">https://real-estate-autopost.vercel.app/api/wa-monitor/webhook</span>
        </p>
      </section>

      <button
        onClick={save}
        disabled={saving}
        className="w-full bb-btn bb-btn-primary"
      >
        {saving ? 'Сохраняю...' : saved ? '✓ Сохранено' : 'Сохранить'}
      </button>
    </div>
  );
}
