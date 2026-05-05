import { format, addMonths, subMonths, startOfMonth, endOfMonth, startOfWeek, endOfWeek, isSameMonth, isSameDay, addDays } from 'date-fns';
import { ChevronLeft, ChevronRight, Briefcase, Heart, Wrench, Calendar as CalendarIcon, Star, Circle, CheckCircle2, X, Plus, Clock } from 'lucide-react';
import { useState } from 'react';
import { useModalBack } from '../hooks/useModalBack';

interface CalendarGridProps {
  currentDate: Date;
  setCurrentDate: (date: Date) => void;
  selectedDate: Date | null;
  setSelectedDate: (date: Date) => void;
  events?: any[];
  userMap?: Record<string, any>;
  view?: 'family' | 'personal';
  onEventClick?: (event: any) => void;
  onAddEventClick?: () => void;
}

export default function CalendarGrid({ currentDate, setCurrentDate, selectedDate, setSelectedDate, events = [], userMap, view, onEventClick, onAddEventClick }: CalendarGridProps) {
  const [isDayModalOpen, setIsDayModalOpen] = useState(false);
  const [modalDay, setModalDay] = useState<Date | null>(null);

  useModalBack(isDayModalOpen, () => setIsDayModalOpen(false));

  const [slideDirection, setSlideDirection] = useState<'left' | 'right' | null>(null);
  const [touchStart, setTouchStart] = useState<number | null>(null);
  const [swipeOffset, setSwipeOffset] = useState(0);
  const minSwipeDistance = 50;

  const nextMonth = () => {
    setSlideDirection('left');
    setCurrentDate(addMonths(currentDate, 1));
  };
  
  const prevMonth = () => {
    setSlideDirection('right');
    setCurrentDate(subMonths(currentDate, 1));
  };

  useEffect(() => {
    if (touchStart === null) return;

    const handlePointerMove = (e: PointerEvent) => {
      setSwipeOffset(e.clientX - touchStart);
    };

    const handlePointerUp = (e: PointerEvent) => {
      const distance = touchStart - e.clientX;
      if (distance > minSwipeDistance) {
        setSlideDirection('left');
        nextMonth();
      } else if (distance < -minSwipeDistance) {
        setSlideDirection('right');
        prevMonth();
      } else {
        setSlideDirection(null);
      }
      setTouchStart(null);
      setSwipeOffset(0);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [touchStart, currentDate]);

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    setTouchStart(e.clientX);
    setSwipeOffset(0);
    setSlideDirection(null);
  };

  const renderHeader = () => {
    return (
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-xl font-bold text-zinc-800 dark:text-zinc-100">
          {format(currentDate, 'MMMM yyyy')}
        </h2>
        <div className="flex gap-2">
          <button onClick={prevMonth} className="p-2 bg-zinc-100 dark:bg-zinc-800 rounded-full hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors">
            <ChevronLeft className="w-5 h-5 text-zinc-600 dark:text-zinc-400" />
          </button>
          <button onClick={nextMonth} className="p-2 bg-zinc-100 dark:bg-zinc-800 rounded-full hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors">
            <ChevronRight className="w-5 h-5 text-zinc-600 dark:text-zinc-400" />
          </button>
        </div>
      </div>
    );
  };

  const renderDays = () => {
    const days = [];
    const startDate = startOfWeek(currentDate);

    for (let i = 0; i < 7; i++) {
      days.push(
        <div key={i} className="text-center font-semibold text-sm text-zinc-500 dark:text-zinc-400 py-2">
          {format(addDays(startDate, i), 'EEE')}
        </div>
      );
    }
    return <div className="grid grid-cols-7 mb-2">{days}</div>;
  };

  const renderCells = () => {
    const monthStart = startOfMonth(currentDate);
    const monthEnd = endOfMonth(monthStart);
    const startDate = startOfWeek(monthStart);
    const endDate = endOfWeek(monthEnd);

    const rows = [];
    let days = [];
    let day = startDate;
    let formattedDate = '';

    while (day <= endDate) {
      for (let i = 0; i < 7; i++) {
        formattedDate = format(day, 'd');
        const cloneDay = day;
        
        const isSelected = selectedDate ? isSameDay(day, selectedDate) : false;
        const isCurrentMonth = isSameMonth(day, monthStart);
        const isToday = isSameDay(day, new Date());
        
        // Find events for this day
        const dayEvents = events.filter(ev => {
          if (!ev.date) return false;
          const evDate = new Date(ev.date);
          return isSameDay(evDate, day);
        });

        days.push(
          <div 
            key={day.toString()} 
            onClick={() => { 
              setSelectedDate(cloneDay);
              setModalDay(cloneDay);
              setIsDayModalOpen(true);
            }}
            className={`
              min-h-[80px] p-2 border border-zinc-100 dark:border-zinc-800/50 cursor-pointer transition-all
              ${!isCurrentMonth ? 'text-zinc-400 dark:text-zinc-600 bg-zinc-50/50 dark:bg-zinc-900/30' : 'text-zinc-800 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800'}
              ${isSelected ? 'ring-2 ring-primary z-10 relative bg-primary/10 dark:bg-primary/20' : ''}
            `}
          >
            <div className={`
              w-7 h-7 flex items-center justify-center rounded-full text-sm
              ${isToday ? 'bg-primary text-white font-bold shadow-sm' : ''}
            `}>
              {formattedDate}
            </div>
            {/* Events indicators */}
            <div className="flex-1 relative">
              <div className="flex flex-wrap gap-1.5 mt-2 justify-center pt-2">
              {dayEvents.slice(0, 4).map((ev: any, idx: number) => {
                let Icon = Circle;
                let colorClass = 'text-zinc-500 bg-zinc-100 dark:bg-zinc-800';

                switch (ev.categoryId) {
                  case 'work': 
                    Icon = Briefcase; 
                    colorClass = 'text-blue-500 bg-blue-50 dark:bg-blue-500/10'; 
                    break;
                  case 'family': 
                    Icon = Heart; 
                    colorClass = 'text-rose-500 bg-rose-50 dark:bg-rose-500/10'; 
                    break;
                  case 'chores': 
                    Icon = Wrench; 
                    colorClass = 'text-amber-500 bg-amber-50 dark:bg-amber-500/10'; 
                    break;
                  case 'appointments': 
                    Icon = CalendarIcon; 
                    colorClass = 'text-emerald-500 bg-emerald-50 dark:bg-emerald-500/10'; 
                    break;
                  case 'important': 
                    Icon = Star; 
                    colorClass = 'text-violet-500 bg-violet-50 dark:bg-violet-500/10'; 
                    break;
                }

                return (
                  <button 
                    key={idx} 
                    onClick={(e) => { e.stopPropagation(); onEventClick && onEventClick(ev); }}
                    className={`relative p-1 rounded-md transition-transform hover:scale-110 ${colorClass}`}
                    title={ev.title}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    {ev.isTask && ev.taskStatus === 'completed' && (
                      <div className="absolute inset-0 flex items-center justify-center bg-white dark:bg-zinc-900 rounded-md">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                      </div>
                    )}
                    {view !== 'personal' && userMap && (
                      <div className="absolute -top-2 -right-2 flex -space-x-1">
                        {(() => {
                          const ids = ev.assigneeIds?.length > 0 ? ev.assigneeIds : (ev.assigneeId ? [ev.assigneeId] : [ev.ownerId]);
                          return ids.slice(0, 2).map((id: string, idx: number) => userMap[id] && (
                            <div key={id} className={`w-4 h-4 bg-zinc-800 text-white dark:bg-zinc-200 dark:text-zinc-900 rounded-full flex items-center justify-center text-[8px] font-bold shadow-sm border border-white dark:border-zinc-900 overflow-hidden z-[${2 - idx}]`}>
                              {userMap[id].photoURL ? (
                                <img src={userMap[id].photoURL} className="w-full h-full object-cover" />
                              ) : (
                                userMap[id].email?.charAt(0).toUpperCase() || '?'
                              )}
                            </div>
                          ));
                        })()}
                      </div>
                    )}
                  </button>
                );
              })}
              {dayEvents.length > 4 && (
                <div className="text-[10px] font-bold text-zinc-500 flex items-center justify-center p-1 bg-zinc-100 dark:bg-zinc-800 rounded-md">
                  +{dayEvents.length - 4}
                </div>
              )}
              </div>
            </div>
          </div>
        );
        day = addDays(day, 1);
      }
      rows.push(
        <div className="grid grid-cols-7" key={day.toString()}>
          {days}
        </div>
      );
      days = [];
    }
    return (
      <div 
        key={currentDate.toString()} 
        className={`border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden bg-white dark:bg-zinc-900 shadow-sm animate-in fade-in duration-300 ${
          slideDirection === 'left' ? 'slide-in-from-right-16' : 
          slideDirection === 'right' ? 'slide-in-from-left-16' : ''
        }`}
      >
        {rows}
      </div>
    );
  };

  return (
    <div 
      className="w-full relative overflow-x-hidden"
      onPointerDown={handlePointerDown}
      style={{ touchAction: 'pan-y' }}
    >
      <div style={{ transform: touchStart !== null ? `translateX(${swipeOffset}px)` : 'none', transition: touchStart === null ? 'transform 0.3s ease-out' : 'none' }}>
        {renderHeader()}
        {renderDays()}
        {renderCells()}
      </div>

      {/* Day Events Modal */}
      {isDayModalOpen && modalDay && (
        <div onClick={() => setIsDayModalOpen(false)} className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div onClick={(e) => e.stopPropagation()} className="bg-white dark:bg-zinc-900 rounded-2xl w-full max-w-sm max-h-[80vh] flex flex-col shadow-xl overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="px-5 py-4 border-b border-zinc-100 dark:border-zinc-800 flex justify-between items-center shrink-0">
              <h3 className="font-semibold text-lg text-zinc-900 dark:text-zinc-100">
                {format(modalDay, 'EEEE, MMMM d')}
              </h3>
              <button onClick={() => setIsDayModalOpen(false)} className="p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 bg-zinc-100 dark:bg-zinc-800 rounded-full transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 overflow-y-auto flex-1 flex flex-col gap-3">
              {events.filter(ev => isSameDay(new Date(ev.date), modalDay)).length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-sm text-zinc-500 mb-4">No events scheduled for this day.</p>
                  <button 
                    onClick={() => { 
                      setIsDayModalOpen(false); 
                      if (onAddEventClick) {
                        setTimeout(() => onAddEventClick(), 50);
                      }
                    }}
                    className="px-4 py-2 bg-primary hover:bg-primary/90 text-white text-sm font-medium rounded-lg transition-colors inline-flex items-center gap-2"
                  >
                    <Plus className="w-4 h-4" /> Add Event
                  </button>
                </div>
              ) : (
                <>
                  {events.filter(ev => isSameDay(new Date(ev.date), modalDay)).map((ev: any, idx: number) => {
                    let Icon = Circle;
                    let colorClass = 'text-zinc-500 bg-zinc-100 dark:bg-zinc-800';

                    switch (ev.categoryId) {
                      case 'work': Icon = Briefcase; colorClass = 'text-blue-500 bg-blue-50 dark:bg-blue-500/10'; break;
                      case 'family': Icon = Heart; colorClass = 'text-rose-500 bg-rose-50 dark:bg-rose-500/10'; break;
                      case 'chores': Icon = Wrench; colorClass = 'text-amber-500 bg-amber-50 dark:bg-amber-500/10'; break;
                      case 'appointments': Icon = CalendarIcon; colorClass = 'text-emerald-500 bg-emerald-50 dark:bg-emerald-500/10'; break;
                      case 'important': Icon = Star; colorClass = 'text-violet-500 bg-violet-50 dark:bg-violet-500/10'; break;
                    }

                    return (
                      <div 
                        key={idx} 
                        onClick={() => { 
                          setIsDayModalOpen(false); 
                          if (onEventClick) {
                            setTimeout(() => onEventClick(ev), 50);
                          }
                        }}
                        className="flex items-center gap-3 p-3 bg-zinc-50 dark:bg-zinc-800/50 rounded-xl cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors border border-zinc-200 dark:border-zinc-700"
                      >
                        <div className={`p-2 rounded-lg ${colorClass}`}>
                          <Icon className="w-4 h-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-zinc-900 dark:text-zinc-100 text-sm flex items-center gap-2">
                            {ev.title}
                            {ev.checklistItems && ev.checklistItems.length > 0 && (
                              <span className="text-xs text-zinc-500 dark:text-zinc-400 font-normal">
                                ({ev.checklistItems.length} item{ev.checklistItems.length !== 1 ? 's' : ''})
                              </span>
                            )}
                            {ev.isTask && ev.taskStatus === 'completed' && <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
                          </p>
                          <div className="flex items-center gap-3 mt-1 flex-wrap">
                            {ev.time && (
                              <span className="text-xs text-zinc-500 flex items-center gap-1"><Clock className="w-3 h-3" /> {ev.time}</span>
                            )}
                            {view !== 'personal' && userMap && (
                              <div className="flex items-center gap-1">
                                <div className="flex -space-x-1 shrink-0">
                                  {(() => {
                                    const ids = ev.assigneeIds?.length > 0 ? ev.assigneeIds : (ev.assigneeId ? [ev.assigneeId] : [ev.ownerId]);
                                    return ids.slice(0, 3).map((id: string, idx: number) => userMap[id] && (
                                      <div key={id} className={`w-4 h-4 rounded-full border border-white dark:border-zinc-900 bg-zinc-200 dark:bg-zinc-700 flex items-center justify-center overflow-hidden shrink-0 z-[${3 - idx}]`} title={userMap[id].name || userMap[id].email}>
                                        {userMap[id].photoURL ? (
                                          <img src={userMap[id].photoURL} className="w-full h-full object-cover" />
                                        ) : (
                                          <span className="text-[8px] font-bold text-zinc-500">
                                            {userMap[id].email?.charAt(0).toUpperCase() || '?'}
                                          </span>
                                        )}
                                      </div>
                                    ));
                                  })()}
                                </div>
                                {(() => {
                                  const ids = ev.assigneeIds?.length > 0 ? ev.assigneeIds : (ev.assigneeId ? [ev.assigneeId] : [ev.ownerId]);
                                  return ids.length > 3 && (
                                    <span className="text-xs text-zinc-500">+{ids.length - 3}</span>
                                  );
                                })()}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  <button 
                    onClick={() => { 
                      setIsDayModalOpen(false); 
                      if (onAddEventClick) {
                        setTimeout(() => onAddEventClick(), 50);
                      }
                    }}
                    className="mt-2 w-full py-2.5 border-2 border-dashed border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:text-zinc-800 hover:border-zinc-300 dark:hover:text-zinc-200 dark:hover:border-zinc-600 rounded-xl text-sm font-medium transition-colors flex items-center justify-center gap-2"
                  >
                    <Plus className="w-4 h-4" /> Add Event
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
