"use client";

import React from "react";
import { MessageSquare, Mail, Clock, Smartphone } from "lucide-react";
import Link from "next/link";
import { motion } from "framer-motion";

const Hero = () => {
  return (
    <section className="relative w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 lg:py-20 flex flex-col lg:flex-row items-center justify-between gap-12 overflow-hidden">
      {/* Left Column: Content */}
      <div className="w-full lg:w-5/12 flex flex-col items-start text-left z-10">
        <h1 className="text-5xl lg:text-7xl font-extrabold text-[#0B3558] tracking-tight leading-[1.1] mb-6">
          Easy
          <br />
          scheduling
          <br />
          ahead
        </h1>
        <p className="text-lg text-slate-500 mb-8 max-w-md leading-relaxed">
          Join 20 million professionals who easily book meetings with the #1 scheduling tool.
        </p>

        <div className="w-full max-w-sm flex flex-col gap-3">
          <button className="flex items-center justify-center gap-3 w-full bg-[#1A73E8] hover:bg-[#155DB1] text-white py-3.5 px-4 rounded-md font-semibold transition-colors duration-200 shadow-sm relative overflow-hidden">
            <div className="bg-white p-1 rounded-sm absolute left-1.5 top-1.5 bottom-1.5 flex items-center justify-center aspect-square">
              <svg width="18" height="18" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
            </div>
            Sign up with Google
          </button>
          
          <button className="flex items-center justify-center gap-3 w-full bg-[#1D2B36] hover:bg-[#121A21] text-white py-3.5 px-4 rounded-md font-semibold transition-colors duration-200 shadow-sm relative overflow-hidden">
             <div className="bg-white p-1 rounded-sm absolute left-1.5 top-1.5 bottom-1.5 flex items-center justify-center aspect-square">
                <svg width="18" height="18" viewBox="0 0 21 21" xmlns="http://www.w3.org/2000/svg">
                  <path d="M10 0H0v10h10V0z" fill="#f25022"/>
                  <path d="M21 0H11v10h10V0z" fill="#7fba00"/>
                  <path d="M10 11H0v10h10V11z" fill="#00a4ef"/>
                  <path d="M21 11H11v10h10V11z" fill="#ffb900"/>
                </svg>
            </div>
            Sign up with Microsoft
          </button>
        </div>

        <div className="w-full max-w-sm flex items-center my-6">
          <div className="flex-1 border-t border-gray-200"></div>
          <span className="px-4 text-xs text-gray-400 font-semibold uppercase tracking-wider">OR</span>
          <div className="flex-1 border-t border-gray-200"></div>
        </div>

        <div className="text-sm text-slate-500">
          <Link href="/signup" className="text-blue-600 hover:underline font-medium">Sign up free with email.</Link>
          <span className="ml-1">No credit card required</span>
        </div>
      </div>

      {/* Right Column: Visuals */}
      <div className="w-full lg:w-7/12 relative flex justify-center lg:justify-end mt-12 lg:mt-0 min-h-[500px]">
        {/* Background Colorful Shapes */}
        <div className="absolute top-[-10%] right-[-15%] w-[120%] h-[120%] z-0 pointer-events-none">
          <motion.div 
            animate={{ 
              y: ["0%", "-5%", "0%"],
              rotate: [12, 15, 12]
            }}
            transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
            className="absolute top-0 right-[10%] w-[80%] h-[70%] bg-[#0CA5E9] rounded-tl-[100px] rounded-br-[80px] rounded-bl-[140px] opacity-90 blur-[2px]"
          />
          <motion.div 
            animate={{ 
              y: ["0%", "8%", "0%"],
              rotate: [-6, -2, -6]
            }}
            transition={{ duration: 10, repeat: Infinity, ease: "easeInOut", delay: 1 }}
            className="absolute bottom-[0%] right-[-5%] w-[60%] h-[60%] bg-[#D946EF] rounded-tl-[140px] rounded-br-[100px] rounded-bl-[60px] opacity-90 blur-[2px]"
          />
          <motion.div 
            animate={{ 
              scale: [1, 1.05, 1],
              x: ["0%", "5%", "0%"]
            }}
            transition={{ duration: 7, repeat: Infinity, ease: "easeInOut", delay: 2 }}
            className="absolute top-[30%] right-[0%] w-[50%] h-[50%] bg-[#2563EB] rounded-full opacity-90 blur-[2px]"
          />
        </div>

        {/* Main Floating Card */}
        <motion.div 
          initial={{ opacity: 0, x: 50 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className="relative z-10 bg-white/95 backdrop-blur-xl rounded-[2rem] shadow-[0_20px_50px_-12px_rgba(0,0,0,0.15)] p-8 lg:p-10 w-full max-w-[640px] border border-white/40"
        >
          <motion.h2 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.4 }}
            className="text-[1.75rem] font-bold text-[#0B3558] mb-8 tracking-tight"
          >
            Reduce no-shows and stay on track
          </motion.h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            
            {/* Inner Card 1: Text Reminder */}
            <motion.div 
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.6 }}
              whileHover={{ y: -5, boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.1)" }}
              className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 flex flex-col items-center relative transition-shadow duration-300"
            >
              <div className="absolute top-4 left-4 bg-blue-50 text-[#1A73E8] text-[10px] font-bold px-2 py-1 rounded-full uppercase tracking-wider">
                Workflow
              </div>
              
              <div className="mt-6 mb-4 relative">
                <Smartphone className="w-10 h-10 text-[#1A73E8]" strokeWidth={1.5} />
                <div className="absolute -top-1 -right-2 bg-white rounded-full p-0.5 shadow-sm">
                  <div className="bg-[#10B981] rounded-full p-1 text-white">
                    <Clock className="w-3 h-3" strokeWidth={3} />
                  </div>
                </div>
              </div>

              <h3 className="font-bold text-[#0B3558] text-base mb-6 text-center">
                Send text reminder
              </h3>

              <div className="w-full text-center border border-[#1A73E8] text-[#0B3558] text-xs font-semibold py-2.5 px-4 rounded-lg relative z-10 bg-white">
                24 hours before event starts
              </div>

              {/* Connecting line */}
              <motion.div 
                initial={{ height: 0 }}
                animate={{ height: "1.5rem" }}
                transition={{ duration: 0.5, delay: 1.2 }}
                className="w-px border-l-2 border-dashed border-[#1A73E8] opacity-50 my-1 origin-top"
              ></motion.div>

              <motion.div 
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.4, delay: 1.5 }}
                className="w-full bg-[#F3F8FF] rounded-lg p-2.5 flex items-center justify-center gap-2"
              >
                 <div className="bg-[#10B981] p-1 rounded flex items-center justify-center">
                   <MessageSquare className="w-3 h-3 text-white" strokeWidth={2.5}/>
                 </div>
                 <span className="text-xs font-semibold text-[#0B3558]">Send text to invitees</span>
              </motion.div>
            </motion.div>

            {/* Inner Card 2: Follow-up Email */}
            <motion.div 
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.8 }}
              whileHover={{ y: -5, boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.1)" }}
              className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 flex flex-col items-center relative transition-shadow duration-300"
            >
              <div className="absolute top-4 left-4 bg-blue-50 text-[#1A73E8] text-[10px] font-bold px-2 py-1 rounded-full uppercase tracking-wider">
                Workflow
              </div>
              
              <div className="mt-6 mb-4 relative">
                <Mail className="w-10 h-10 text-[#1A73E8]" strokeWidth={1.5} />
                <div className="absolute -top-1 -right-2 bg-white rounded-full p-0.5 shadow-sm">
                  <div className="bg-[#8B5CF6] rounded-full p-1 text-white">
                    <Clock className="w-3 h-3" strokeWidth={3} />
                  </div>
                </div>
              </div>

              <h3 className="font-bold text-[#0B3558] text-base mb-6 text-center">
                Send follow-up email
              </h3>

              <div className="w-full text-center border border-[#1A73E8] text-[#0B3558] text-xs font-semibold py-2.5 px-4 rounded-lg relative z-10 bg-white">
                2 hours after event ends
              </div>

              {/* Connecting line */}
              <motion.div 
                initial={{ height: 0 }}
                animate={{ height: "1.5rem" }}
                transition={{ duration: 0.5, delay: 1.4 }}
                className="w-px border-l-2 border-dashed border-[#1A73E8] opacity-50 my-1 origin-top"
              ></motion.div>

              <motion.div 
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.4, delay: 1.7 }}
                className="w-full bg-[#F3F8FF] rounded-lg p-2.5 flex items-center justify-center gap-2"
              >
                 <div className="text-[#1A73E8] flex items-center justify-center">
                   <Mail className="w-4 h-4" strokeWidth={2.5} fill="#1A73E8" color="white"/>
                 </div>
                 <span className="text-xs font-semibold text-[#0B3558]">Send email to invitees</span>
              </motion.div>
            </motion.div>

          </div>
        </motion.div>
      </div>
    </section>
  );
};

export default Hero;