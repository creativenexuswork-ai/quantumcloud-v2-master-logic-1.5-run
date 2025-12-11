// ============= Session Event Brain =============
// Determines session timing and provides trading adjustments

export type SessionPhase = 
  | 'asia_early'
  | 'asia_late'
  | 'london_early'
  | 'london_prime'
  | 'overlap'      // London/NY overlap - best liquidity
  | 'ny_prime'
  | 'ny_late'
  | 'off_hours';

export interface SessionInfo {
  phase: SessionPhase;
  name: string;
  quality: number;          // 0-1 overall session quality
  volatilityExpected: 'low' | 'normal' | 'high';
  spreadExpected: 'tight' | 'normal' | 'wide';
  recommendedModes: ('burst' | 'scalper' | 'trend')[];
}

export interface SessionAdjustments {
  entryThresholdMultiplier: number;   // 1.0 = normal, >1 = stricter, <1 = looser
  sizeMultiplier: number;             // 1.0 = normal, <1 = smaller sizes
  tpMultiplier: number;               // 1.0 = normal, adjust TP targets
  aggressiveness: 'conservative' | 'normal' | 'aggressive';
}

export interface KnownEvent {
  name: string;
  timeUTC: string;
  impact: 'low' | 'medium' | 'high';
  currencies: string[];
}

function getUTCHour(): number {
  return new Date().getUTCHours();
}

function getUTCMinute(): number {
  return new Date().getUTCMinutes();
}

function getDayOfWeek(): number {
  return new Date().getUTCDay(); // 0 = Sunday, 6 = Saturday
}

/**
 * Determine current session phase
 */
export function getCurrentSession(): SessionInfo {
  const hour = getUTCHour();
  const day = getDayOfWeek();
  
  // Weekend - markets mostly closed
  if (day === 0 || day === 6) {
    return {
      phase: 'off_hours',
      name: 'Weekend',
      quality: 0.1,
      volatilityExpected: 'low',
      spreadExpected: 'wide',
      recommendedModes: []
    };
  }
  
  // Asia session: 00:00 - 08:00 UTC
  if (hour >= 0 && hour < 3) {
    return {
      phase: 'asia_early',
      name: 'Early Asia',
      quality: 0.5,
      volatilityExpected: 'low',
      spreadExpected: 'normal',
      recommendedModes: ['scalper']
    };
  }
  
  if (hour >= 3 && hour < 7) {
    return {
      phase: 'asia_late',
      name: 'Late Asia',
      quality: 0.55,
      volatilityExpected: 'normal',
      spreadExpected: 'normal',
      recommendedModes: ['scalper', 'trend']
    };
  }
  
  // London early: 07:00 - 08:30 UTC
  if (hour === 7 || (hour === 8 && getUTCMinute() < 30)) {
    return {
      phase: 'london_early',
      name: 'London Open',
      quality: 0.8,
      volatilityExpected: 'high',
      spreadExpected: 'normal',
      recommendedModes: ['burst', 'trend']
    };
  }
  
  // London prime: 08:30 - 12:30 UTC
  if ((hour === 8 && getUTCMinute() >= 30) || (hour >= 9 && hour < 13)) {
    return {
      phase: 'london_prime',
      name: 'London Session',
      quality: 0.9,
      volatilityExpected: 'normal',
      spreadExpected: 'tight',
      recommendedModes: ['burst', 'scalper', 'trend']
    };
  }
  
  // Overlap: 13:00 - 16:00 UTC (NY open + London still active)
  if (hour >= 13 && hour < 16) {
    return {
      phase: 'overlap',
      name: 'London/NY Overlap',
      quality: 1.0,
      volatilityExpected: 'high',
      spreadExpected: 'tight',
      recommendedModes: ['burst', 'scalper', 'trend']
    };
  }
  
  // NY prime: 16:00 - 20:00 UTC
  if (hour >= 16 && hour < 20) {
    return {
      phase: 'ny_prime',
      name: 'NY Session',
      quality: 0.85,
      volatilityExpected: 'normal',
      spreadExpected: 'tight',
      recommendedModes: ['burst', 'scalper', 'trend']
    };
  }
  
  // NY late: 20:00 - 22:00 UTC
  if (hour >= 20 && hour < 22) {
    return {
      phase: 'ny_late',
      name: 'Late NY',
      quality: 0.6,
      volatilityExpected: 'low',
      spreadExpected: 'normal',
      recommendedModes: ['scalper', 'trend']
    };
  }
  
  // Off hours: 22:00 - 00:00 UTC
  return {
    phase: 'off_hours',
    name: 'Off Hours',
    quality: 0.3,
    volatilityExpected: 'low',
    spreadExpected: 'wide',
    recommendedModes: ['scalper']
  };
}

/**
 * Get adjustments for current session
 */
export function getSessionAdjustments(session: SessionInfo): SessionAdjustments {
  // Base adjustments by session quality
  const qualityFactor = session.quality;
  
  // Entry threshold: stricter in poor sessions
  const entryThresholdMultiplier = qualityFactor < 0.5 ? 1.3 : 
                                    qualityFactor < 0.7 ? 1.1 : 
                                    qualityFactor < 0.9 ? 1.0 : 0.95;
  
  // Size: smaller in poor sessions
  const sizeMultiplier = qualityFactor < 0.5 ? 0.6 :
                         qualityFactor < 0.7 ? 0.8 :
                         qualityFactor < 0.9 ? 1.0 : 1.1;
  
  // TP: adjust based on expected volatility
  let tpMultiplier = 1.0;
  if (session.volatilityExpected === 'high') {
    tpMultiplier = 1.3; // Bigger moves expected
  } else if (session.volatilityExpected === 'low') {
    tpMultiplier = 0.7; // Tighter targets
  }
  
  // Aggressiveness
  let aggressiveness: 'conservative' | 'normal' | 'aggressive' = 'normal';
  if (qualityFactor >= 0.9 && session.volatilityExpected !== 'low') {
    aggressiveness = 'aggressive';
  } else if (qualityFactor < 0.6 || session.spreadExpected === 'wide') {
    aggressiveness = 'conservative';
  }
  
  return {
    entryThresholdMultiplier,
    sizeMultiplier,
    tpMultiplier,
    aggressiveness
  };
}

/**
 * Check if we're near a known high-impact event window
 * Note: In a real system, this would pull from an economic calendar API
 */
export function checkEventProximity(): { 
  nearEvent: boolean; 
  event: KnownEvent | null;
  minutesUntil: number | null;
} {
  // High impact times (simplified - in real system, pull from calendar)
  const hour = getUTCHour();
  const minute = getUTCMinute();
  const day = getDayOfWeek();
  
  // NFP - First Friday of month at 13:30 UTC
  if (day === 5 && hour >= 13 && hour <= 14) {
    const dateNow = new Date();
    if (dateNow.getUTCDate() <= 7) {
      return {
        nearEvent: true,
        event: {
          name: 'Non-Farm Payrolls',
          timeUTC: '13:30',
          impact: 'high',
          currencies: ['USD', 'EUR', 'GBP']
        },
        minutesUntil: hour === 13 ? (30 - minute) : null
      };
    }
  }
  
  // FOMC - Wednesdays at 18:00 or 19:00 UTC (varies)
  if (day === 3 && hour >= 17 && hour <= 20) {
    return {
      nearEvent: true,
      event: {
        name: 'FOMC Decision',
        timeUTC: '18:00',
        impact: 'high',
        currencies: ['USD', 'EUR', 'GBP', 'JPY']
      },
      minutesUntil: null // Uncertain exact time
    };
  }
  
  // ECB - Thursdays at 12:45 UTC
  if (day === 4 && hour >= 12 && hour <= 14) {
    return {
      nearEvent: true,
      event: {
        name: 'ECB Decision',
        timeUTC: '12:45',
        impact: 'high',
        currencies: ['EUR', 'USD', 'GBP']
      },
      minutesUntil: hour === 12 ? (45 - minute) : null
    };
  }
  
  return {
    nearEvent: false,
    event: null,
    minutesUntil: null
  };
}

/**
 * Get comprehensive session analysis
 */
export function analyzeSession(): {
  session: SessionInfo;
  adjustments: SessionAdjustments;
  eventCheck: ReturnType<typeof checkEventProximity>;
  shouldReduceExposure: boolean;
} {
  const session = getCurrentSession();
  const adjustments = getSessionAdjustments(session);
  const eventCheck = checkEventProximity();
  
  // Reduce exposure if near high-impact event
  const shouldReduceExposure = eventCheck.nearEvent && 
    eventCheck.event?.impact === 'high' &&
    (eventCheck.minutesUntil !== null && eventCheck.minutesUntil < 30);
  
  return {
    session,
    adjustments,
    eventCheck,
    shouldReduceExposure
  };
}

/**
 * Check if a specific mode is recommended for current session
 */
export function isModeRecommendedForSession(
  mode: 'burst' | 'scalper' | 'trend',
  session: SessionInfo
): boolean {
  return session.recommendedModes.includes(mode);
}
