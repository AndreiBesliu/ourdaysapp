import { format, addMonths, subMonths, startOfMonth, endOfMonth, startOfWeek, endOfWeek, isSameMonth, isSameDay, addDays } from 'date-fns';
import { ChevronLeft, ChevronRight, Briefcase, Heart, Wrench, Calendar as CalendarIcon, Star, Circle, CheckCircle2, X, Plus, Clock, ChevronUp, ChevronDown } from 'lucide-react';
import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useModalBack } from '../hooks/useModalBack';
import { useThemeStore } from '../store';
import { getDateLocale } from '../utils/i18n';

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
  const [isWeekView, setIsWeekView] = useState(false);
  const { language } = useThemeStore();
  const dateLocale = getDateLocale(language);

  useModalBack(isDayModalOpen, () => setIsDayModalOpen(false));

  const [direction, setDirection] = useState<number>(0);
  const swipeConfidenceThreshold = 10000;
  const swipePower = (offset: number, velocity: number) => {
    return Math.abs(offset) * velocity;
  };

  const nextPeriod = () => {
    setDirection(1);
    if (isWeekView) {
      const newDate = addDays(selectedDate || currentDate, 7);
      setSelectedDate(newDate);
      setCurrentDate(newDate);
    } else {
      setCurrentDate(addMonths(currentDate, 1));
    }
  };
  
  const prevPeriod = () => {
    setDirection(-1);
    if (isWeekView) {
      const newDate = addDays(selectedDate || currentDate, -7);
      setSelectedDate(newDate);
      setCurrentDate(newDate);
    } else {
      setCurrentDate(subMonths(currentDate, 1));
    }
  };

  const variants = {
    enter: (direction: number) => ({
      x: direction > 0 ? '100%' : '-100%',
      opacity: 0,
      position: 'absolute' as const,
      width: '100%'
    }),
    center: {
      zIndex: 1,
      x: 0,
      opacity: 1,
      position: 'relative' as const,
      width: '100%'
    },
    exit: (direction: number) => ({
      zIndex: 0,
      x: direction > 0 ? '-100%' : '100%',
      opacity: 0,
      position: 'absolute' as const,
      width: '100%'
    })
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if user is typing in an input
      if (['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName || '')) return;
      
      // Don't trigger if ANY modal is open
      if (document.querySelector('.fixed.inset-0')) return;

      if (!selectedDate) {
        if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
          e.preventDefault();
          setSelectedDate(new Date());
        }
        return;
      }

      let newDate = selectedDate;
      if (e.key === 'ArrowLeft') newDate = addDays(selectedDate, -1);
      else if (e.key === 'ArrowRight') newDate = addDays(selectedDate, 1);
      else if (e.key === 'ArrowUp') newDate = addDays(selectedDate, -7);
      else if (e.key === 'ArrowDown') newDate = addDays(selectedDate, 7);
      else if (e.key === 'Enter') {
        e.preventDefault();
        setModalDay(selectedDate);
        setIsDayModalOpen(true);
        return;
      } else {
        return;
      }

      e.preventDefault();
      setSelectedDate(newDate);

      // Auto-switch month if navigating outside current month
      if (!isSameMonth(newDate, currentDate)) {
        if (newDate < currentDate) {
          setDirection(-1);
        } else {
          setDirection(1);
        }
        setCurrentDate(startOfMonth(newDate));
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedDate, currentDate, setSelectedDate, setCurrentDate]);

  const renderHeader = () => {
    return (
      <div className="flex justify-between items-center mb-4 px-2">
        <h2 className="text-xl font-bold text-zinc-800 dark:text-zinc-100 flex items-center gap-2">
          {isWeekView 
            ? `${format(startOfWeek(selectedDate || currentDate, { locale: dateLocale }), 'd MMM', { locale: dateLocale })} - ${format(endOfWeek(selectedDate || currentDate, { locale: dateLocale }), 'd MMM, yyyy', { locale: dateLocale })}`
            : format(currentDate, 'MMMM yyyy', { locale: dateLocale })
          }
          <button 
            onClick={() => setIsWeekView(!isWeekView)} 
            className="p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-md transition-colors"
            title={isWeekView ? "Expand to Month View" : "Collapse to Week View"}
          >
            {isWeekView ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
          </button>
        </h2>
        <div className="flex gap-2">
          <button onClick={prevPeriod} className="p-2 bg-zinc-100 dark:bg-zinc-800 rounded-full hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors">
            <ChevronLeft className="w-5 h-5 text-zinc-600 dark:text-zinc-400" />
          </button>
          <button onClick={nextPeriod} className="p-2 bg-zinc-100 dark:bg-zinc-800 rounded-full hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors">
            <ChevronRight className="w-5 h-5 text-zinc-600 dark:text-zinc-400" />
          </button>
        </div>
      </div>
    );
  };

  const renderDays = () => {
    const days = [];
    let startDate = startOfWeek(currentDate, { locale: dateLocale });

    for (let i = 0; i < 7; i++) {
      days.push(
        <div key={i} className="text-center text-xs font-bold text-zinc-400 dark:text-zinc-600 uppercase tracking-widest py-2">
          {format(addDays(startDate, i), 'EEE', { locale: dateLocale })}
        </div>
      );
    }
    return <div className="grid grid-cols-7">{days}</div>;
  };

  const renderCells = () => {
    let monthStart, monthEnd, startDate, endDate;
    
    if (isWeekView && selectedDate) {
      startDate = startOfWeek(selectedDate);
      endDate = endOfWeek(selectedDate);
      monthStart = startOfMonth(selectedDate);
    } else {
      monthStart = startOfMonth(currentDate);
      monthEnd = endOfMonth(monthStart);
      startDate = startOfWeek(monthStart);
      endDate = endOfWeek(monthEnd);
    }

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
      <AnimatePresence initial={false} custom={direction}>
        <motion.div
          key={currentDate.toString()}
          custom={direction}
          variants={variants}
          initial="enter"
          animate="center"
          exit="exit"
          transition={{
            x: { type: "spring", stiffness: 300, damping: 30 },
            opacity: { duration: 0.2 }
          }}
          drag="x"
          dragDirectionLock={true}
          dragConstraints={{ left: 0, right: 0 }}
          dragElastic={1}
          onDragEnd={(_, { offset, velocity }) => {
            const swipe = swipePower(offset.x, velocity.x);

            if (swipe < -swipeConfidenceThreshold || offset.x < -50) {
              nextPeriod();
            } else if (swipe > swipeConfidenceThreshold || offset.x > 50) {
              prevPeriod();
            }
          }}
          className="border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden bg-white dark:bg-zinc-900 shadow-sm"
        >
          {rows}
        </motion.div>
      </AnimatePresence>
    );
  };

  return (
    <div className="w-full relative overflow-x-hidden select-none">
      {renderHeader()}
      {renderDays()}
      <div className="relative w-full">
        {renderCells()}
      </div>

      {/* Day Events Modal */}
      {isDayModalOpen && modalDay && (
        <div onClick={() => setIsDayModalOpen(false)} className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div onClick={(e) => e.stopPropagation()} className="bg-white dark:bg-zinc-900 rounded-2xl w-full max-w-sm max-h-[80vh] flex flex-col shadow-xl overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="px-5 py-4 border-b border-zinc-100 dark:border-zinc-800 flex justify-between items-center shrink-0">
              <h3 className="text-xl font-bold text-zinc-900 dark:text-white">
                {modalDay && format(modalDay, 'EEEE, d MMMM', { locale: dateLocale })}
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
