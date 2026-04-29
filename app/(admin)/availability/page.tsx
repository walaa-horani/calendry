"use client";

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Clock, Plus, Trash2, Globe, Check, Calendar } from 'lucide-react';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const TABS = ['Schedules', 'Calendar settings', 'Advanced settings'];

// Default schedule
const defaultSchedule = DAYS.map((day, index) => ({
  day,
  active: index > 0 && index < 6, // Mon-Fri active by default
  intervals: [{ start: '09:00', end: '17:00' }]
}));

export default function AvailabilityPage() {
  const [schedule, setSchedule] = useState(defaultSchedule);
  const [activeTab, setActiveTab] = useState('Schedules');

  const toggleDay = (dayIndex: number) => {
    const newSchedule = [...schedule];
    newSchedule[dayIndex].active = !newSchedule[dayIndex].active;
    setSchedule(newSchedule);
  };

  const updateInterval = (dayIndex: number, intervalIndex: number, field: 'start'|'end', value: string) => {
    const newSchedule = [...schedule];
    newSchedule[dayIndex].intervals[intervalIndex][field] = value;
    setSchedule(newSchedule);
  };

  const addInterval = (dayIndex: number) => {
    const newSchedule = [...schedule];
    newSchedule[dayIndex].intervals.push({ start: '09:00', end: '17:00' });
    setSchedule(newSchedule);
  };

  const removeInterval = (dayIndex: number, intervalIndex: number) => {
    const newSchedule = [...schedule];
    newSchedule[dayIndex].intervals.splice(intervalIndex, 1);
    setSchedule(newSchedule);
  };

  return (
    <div className="relative w-full max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12 lg:py-20 min-h-[calc(100vh-80px)] flex flex-col z-10 overflow-hidden">
      {/* Background Colorful Shapes (matching the hero design) */}
      <div className="absolute top-[0%] right-[0%] w-[100%] h-[100%] z-0 pointer-events-none">
        <motion.div 
          animate={{ 
            y: ["0%", "-5%", "0%"],
            rotate: [12, 15, 12]
          }}
          transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
          className="absolute top-[-10%] right-[0%] w-[60%] h-[60%] bg-[#0CA5E9] rounded-tl-[100px] rounded-br-[80px] rounded-bl-[140px] opacity-10 blur-[60px]"
        />
        <motion.div 
          animate={{ 
            y: ["0%", "8%", "0%"],
            rotate: [-6, -2, -6]
          }}
          transition={{ duration: 10, repeat: Infinity, ease: "easeInOut", delay: 1 }}
          className="absolute bottom-[20%] left-[-10%] w-[50%] h-[50%] bg-[#D946EF] rounded-tl-[140px] rounded-br-[100px] rounded-bl-[60px] opacity-10 blur-[60px]"
        />
      </div>

      <div className="relative z-10 w-full mb-8 text-center lg:text-left">
        <h1 className="text-4xl lg:text-5xl font-extrabold text-[#0B3558] tracking-tight mb-4">
          Availability
        </h1>
        <p className="text-lg text-slate-500 max-w-2xl mx-auto lg:mx-0 leading-relaxed">
          Configure your standard hours. These will be applied to all your event types by default.
        </p>
      </div>

      {/* Tabs */}
      <div className="relative z-10 w-full flex items-center border-b border-gray-200 mb-8 overflow-x-auto hide-scrollbar">
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`whitespace-nowrap px-6 py-4 font-semibold text-sm transition-all relative ${
              activeTab === tab ? 'text-[#1A73E8]' : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            {tab}
            {activeTab === tab && (
              <motion.div
                layoutId="activeTabIndicator"
                className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#1A73E8]"
                initial={false}
                transition={{ type: "spring", stiffness: 500, damping: 30 }}
              />
            )}
          </button>
        ))}
      </div>

      <motion.div 
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: "easeOut" }}
        className="relative z-10 bg-white/95 backdrop-blur-xl rounded-[2rem] shadow-[0_20px_50px_-12px_rgba(0,0,0,0.15)] border border-white/40 overflow-hidden w-full"
      >
        <AnimatePresence mode="wait">
          {activeTab === 'Schedules' && (
            <motion.div
              key="schedules"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
            >
              <div className="px-6 sm:px-10 py-8 border-b border-gray-100 flex flex-col sm:flex-row sm:items-center justify-between gap-6 bg-white/60">
                <div>
                  <h2 className="text-2xl font-bold text-[#0B3558] tracking-tight">Working Hours</h2>
                  <div className="flex items-center text-sm text-slate-500 mt-2 gap-2">
                    <div className="bg-slate-100 p-1.5 rounded-full text-slate-600">
                      <Globe className="w-4 h-4" />
                    </div>
                    <span className="font-medium">Pacific Time - US & Canada</span>
                  </div>
                </div>
                <button className="bg-[#1A73E8] hover:bg-[#155DB1] text-white px-6 py-3 rounded-xl font-semibold transition-all duration-200 text-sm shadow-md hover:shadow-lg flex items-center justify-center gap-2">
                  <Check className="w-4 h-4" />
                  Save changes
                </button>
              </div>

              <div className="p-6 sm:px-10 sm:py-8">
                <div className="flex flex-col gap-8">
                  {schedule.map((dayItem, dIndex) => (
                    <div key={dayItem.day} className="flex flex-col sm:flex-row sm:items-start gap-4 pb-8 border-b border-gray-50 last:border-0 last:pb-0">
                      <div className="w-32 flex items-center gap-4 pt-1 sm:pt-2">
                        <button 
                          onClick={() => toggleDay(dIndex)}
                          className={`w-12 h-7 rounded-full transition-colors relative flex items-center shadow-inner ${dayItem.active ? 'bg-[#10B981]' : 'bg-slate-200'}`}
                        >
                          <motion.div 
                            layout
                            className={`w-5 h-5 bg-white rounded-full shadow-sm absolute ${dayItem.active ? 'right-1' : 'left-1'}`}
                          />
                        </button>
                        <span className={`text-base font-bold ${dayItem.active ? 'text-[#0B3558]' : 'text-slate-400'}`}>
                          {dayItem.day}
                        </span>
                      </div>

                      <div className="flex-1 flex flex-col gap-3">
                        {!dayItem.active ? (
                          <div className="text-slate-400 pt-1 sm:pt-2 font-medium bg-slate-50 px-4 py-2 rounded-lg inline-block w-fit">
                            Unavailable
                          </div>
                        ) : (
                          dayItem.intervals.map((interval, iIndex) => (
                            <motion.div 
                              initial={{ opacity: 0, x: -10 }}
                              animate={{ opacity: 1, x: 0 }}
                              key={iIndex} 
                              className="flex items-center gap-3 flex-wrap"
                            >
                              <div className="flex items-center gap-3">
                                <div className="relative">
                                  <input 
                                    type="time" 
                                    value={interval.start}
                                    onChange={(e) => updateInterval(dIndex, iIndex, 'start', e.target.value)}
                                    className="bg-white border border-gray-200 text-[#0B3558] font-semibold rounded-xl pl-4 pr-2 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#1A73E8]/30 focus:border-[#1A73E8] transition-all shadow-sm"
                                  />
                                </div>
                                <span className="text-slate-400 font-bold">-</span>
                                <div className="relative">
                                  <input 
                                    type="time" 
                                    value={interval.end}
                                    onChange={(e) => updateInterval(dIndex, iIndex, 'end', e.target.value)}
                                    className="bg-white border border-gray-200 text-[#0B3558] font-semibold rounded-xl pl-4 pr-2 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#1A73E8]/30 focus:border-[#1A73E8] transition-all shadow-sm"
                                  />
                                </div>
                              </div>
                              
                              <div className="flex items-center gap-1 ml-2">
                                <button 
                                  onClick={() => removeInterval(dIndex, iIndex)}
                                  className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
                                  title="Remove time slot"
                                >
                                  <Trash2 className="w-5 h-5" />
                                </button>
                                
                                {iIndex === dayItem.intervals.length - 1 && (
                                  <button 
                                    onClick={() => addInterval(dIndex)}
                                    className="p-2 text-slate-400 hover:text-[#1A73E8] hover:bg-blue-50 rounded-lg transition-all"
                                    title="Add time slot"
                                  >
                                    <Plus className="w-5 h-5" />
                                  </button>
                                )}
                              </div>
                            </motion.div>
                          ))
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === 'Calendar settings' && (
            <motion.div
              key="calendar-settings"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
            >
              <div className="px-6 sm:px-10 py-8 border-b border-gray-100 bg-white/60">
                <h2 className="text-2xl font-bold text-[#0B3558] tracking-tight">Connected Calendars</h2>
              </div>
              <div className="p-6 sm:px-10 sm:py-8">
                <div className="flex items-center justify-between p-5 border border-gray-200 rounded-2xl mb-8 bg-white shadow-sm hover:shadow-md transition-shadow">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center border border-slate-200">
                      <Calendar className="w-6 h-6 text-slate-600" />
                    </div>
                    <div>
                      <h3 className="font-bold text-[#0B3558] text-lg">Google Calendar</h3>
                      <p className="text-sm text-slate-500 font-medium mt-0.5">user@example.com</p>
                    </div>
                  </div>
                  <button className="text-[#1A73E8] text-sm font-bold hover:underline px-4 py-2 hover:bg-blue-50 rounded-lg transition-colors">Edit</button>
                </div>

                <div className="mb-8">
                  <h3 className="font-bold text-[#0B3558] mb-2 text-lg">Check for conflicts</h3>
                  <p className="text-sm text-slate-500 mb-4">Calendry will check these calendars for conflicts to prevent double bookings.</p>
                  <div className="flex items-center gap-3 p-4 bg-slate-50 rounded-xl border border-slate-200 w-full max-w-md">
                    <input type="checkbox" defaultChecked className="w-5 h-5 rounded text-[#1A73E8] border-gray-300 focus:ring-[#1A73E8]" />
                    <span className="text-sm font-semibold text-[#0B3558]">user@example.com</span>
                  </div>
                </div>

                <div>
                  <h3 className="font-bold text-[#0B3558] mb-2 text-lg">Add to calendar</h3>
                  <p className="text-sm text-slate-500 mb-4">New events will be added to this calendar.</p>
                  <select className="w-full max-w-md bg-white border border-gray-200 text-[#0B3558] font-semibold rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#1A73E8]/30 focus:border-[#1A73E8] transition-all shadow-sm">
                    <option>user@example.com</option>
                  </select>
                </div>
                
                <div className="mt-8 pt-6 border-t border-gray-100">
                  <button className="bg-[#1A73E8] hover:bg-[#155DB1] text-white px-6 py-3 rounded-xl font-semibold transition-all duration-200 text-sm shadow-md hover:shadow-lg flex items-center justify-center gap-2">
                    <Check className="w-4 h-4" />
                    Save changes
                  </button>
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === 'Advanced settings' && (
            <motion.div
              key="advanced-settings"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
            >
              <div className="px-6 sm:px-10 py-8 border-b border-gray-100 bg-white/60">
                <h2 className="text-2xl font-bold text-[#0B3558] tracking-tight">Advanced Settings</h2>
              </div>
              <div className="p-6 sm:px-10 sm:py-8">
                <div className="mb-8">
                  <h3 className="font-bold text-[#0B3558] mb-2 text-lg">Minimum Notice</h3>
                  <p className="text-sm text-slate-500 mb-4">Avoid last minute bookings.</p>
                  <select className="w-full max-w-xs bg-white border border-gray-200 text-[#0B3558] font-semibold rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#1A73E8]/30 focus:border-[#1A73E8] transition-all shadow-sm">
                    <option>4 hours</option>
                    <option>12 hours</option>
                    <option>24 hours</option>
                    <option>48 hours</option>
                  </select>
                </div>
                
                <div className="mb-8">
                  <h3 className="font-bold text-[#0B3558] mb-2 text-lg">Buffer Time</h3>
                  <p className="text-sm text-slate-500 mb-4">Add extra time before or after events.</p>
                  <select className="w-full max-w-xs bg-white border border-gray-200 text-[#0B3558] font-semibold rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#1A73E8]/30 focus:border-[#1A73E8] transition-all shadow-sm">
                    <option>0 minutes</option>
                    <option>15 minutes</option>
                    <option>30 minutes</option>
                    <option>1 hour</option>
                  </select>
                </div>
                
                <div className="mt-8 pt-6 border-t border-gray-100">
                  <button className="bg-[#1A73E8] hover:bg-[#155DB1] text-white px-6 py-3 rounded-xl font-semibold transition-all duration-200 text-sm shadow-md hover:shadow-lg flex items-center justify-center gap-2">
                    <Check className="w-4 h-4" />
                    Save changes
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}