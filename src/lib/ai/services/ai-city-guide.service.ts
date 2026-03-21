import prisma from '../../prisma';
import { cleanJSON, isAIEnabled, proModel } from '../gemini.client';
import {
  CITY_GUIDE_FOLLOW_UP_PROMPT,
  CITY_GUIDE_ITINERARY_PROMPT,
  CITY_GUIDE_RECOMMENDATION_PROMPT,
} from '../prompts/city-guide.prompts';

type CandidateType = 'merchant' | 'deal' | 'event';

export interface CityGuideRequest {
  userId: number;
  lat: number;
  lng: number;
  radiusKm?: number;
  intent?: string;
  timeOfDay?: string;
  preferences?: string[];
}

export interface CityGuideFollowUpRequest extends CityGuideRequest {
  followUpQuestion: string;
  previousRecommendations?: { candidateId: string; reason?: string }[];
}

export interface CityGuideItineraryRequest extends CityGuideRequest {
  maxStops?: number;
}

interface CandidateBase {
  candidateId: string;
  type: CandidateType;
  name: string;
  description: string;
  distanceKm: number;
  latitude: number;
  longitude: number;
  city?: string | null;
  mapUrl: string;
  eta: {
    walkingMinutes: number;
    drivingMinutes: number;
  };
}

interface MerchantCandidate extends CandidateBase {
  type: 'merchant';
  merchantId: number;
  vibeTags: string[];
  amenities: string[];
  activeDealCount: number;
}

interface DealCandidate extends CandidateBase {
  type: 'deal';
  dealId: number;
  merchantId: number;
  merchantName: string;
  offerDisplay: string;
  endTime: string;
}

interface EventCandidate extends CandidateBase {
  type: 'event';
  eventId: number;
  eventType: string;
  startDate: string;
  venueName: string | null;
}

type CityGuideCandidate = MerchantCandidate | DealCandidate | EventCandidate;

interface AIRecommendation {
  candidateId: string;
  reason: string;
  bestFor: string[];
  insiderTip: string;
}

interface AIRecommendationPayload {
  summary: string;
  followUpQuestion: string;
  recommendations: AIRecommendation[];
}

interface AIItineraryStop {
  candidateId: string;
  reason: string;
  visitWindow: string;
}

interface AIItineraryPayload {
  summary: string;
  tips: string[];
  stops: AIItineraryStop[];
}

const DEFAULT_RADIUS_KM = 5;
const MAX_RADIUS_KM = 25;

function clampRadius(radiusKm?: number): number {
  if (!radiusKm || Number.isNaN(radiusKm)) return DEFAULT_RADIUS_KM;
  return Math.min(Math.max(radiusKm, 1), MAX_RADIUS_KM);
}

function calculateDistanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const earthRadiusKm = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusKm * c;
}

function estimateEta(distanceKm: number): { walkingMinutes: number; drivingMinutes: number } {
  const walkingMinutes = Math.max(3, Math.round((distanceKm / 4.8) * 60));
  const drivingMinutes = Math.max(4, Math.round((distanceKm / 28) * 60));
  return { walkingMinutes, drivingMinutes };
}

function buildMapUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}

function normalizeArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map(item => item.trim())
    .filter(Boolean);
}

function getTimeOfDay(value?: string): string {
  if (value && value.trim()) return value.trim();

  const hour = new Date().getHours();
  if (hour < 11) return 'morning';
  if (hour < 16) return 'afternoon';
  if (hour < 21) return 'evening';
  return 'night';
}

function formatOfferDisplay(discountPercentage: number | null, discountAmount: number | null): string {
  if (discountPercentage) return `${discountPercentage}% off`;
  if (discountAmount) return `$${discountAmount} off`;
  return 'Special offer';
}

function compactText(value: string | null | undefined, fallback: string): string {
  return value?.trim() ? value.trim() : fallback;
}

export class AICityGuideService {
  async recommend(input: CityGuideRequest) {
    return this.buildGuideRecommendations(input);
  }

  async followUp(input: CityGuideFollowUpRequest) {
    if (!input.followUpQuestion.trim()) {
      throw new Error('Follow-up question is required.');
    }

    return this.buildGuideRecommendations(input);
  }

  async itinerary(input: CityGuideItineraryRequest) {
    if (!isAIEnabled()) throw new Error('AI features are not configured on this server.');

    const context = await this.getGuideContext(input);
    const maxStops = Math.min(Math.max(input.maxStops ?? 3, 2), 5);
    const prompt = CITY_GUIDE_ITINERARY_PROMPT({
      userName: context.userName,
      loyaltyTier: context.loyaltyTier,
      intent: context.intent,
      timeOfDay: context.timeOfDay,
      radiusKm: context.radiusKm,
      preferences: context.preferences,
      history: context.userHistory,
      candidateSummary: context.candidateSummary,
      currentDate: new Date().toISOString(),
      maxStops,
    });

    const payload = await this.generateJSON<AIItineraryPayload>(prompt);
    const stops = this.mapItineraryStops(payload, context.candidateMap, maxStops);

    return {
      summary: payload.summary,
      tips: normalizeArray(payload.tips).slice(0, 4),
      stops,
      generatedAt: new Date().toISOString(),
    };
  }

  private async buildGuideRecommendations(
    input: CityGuideRequest | CityGuideFollowUpRequest
  ) {
    if (!isAIEnabled()) throw new Error('AI features are not configured on this server.');

    const context = await this.getGuideContext(input);
    const isFollowUp = 'followUpQuestion' in input;
    const prompt = isFollowUp
      ? CITY_GUIDE_FOLLOW_UP_PROMPT({
          userName: context.userName,
          loyaltyTier: context.loyaltyTier,
          intent: context.intent,
          timeOfDay: context.timeOfDay,
          radiusKm: context.radiusKm,
          preferences: context.preferences,
          history: context.userHistory,
          candidateSummary: context.candidateSummary,
          currentDate: new Date().toISOString(),
          followUpQuestion: input.followUpQuestion,
          previousSummary: (input.previousRecommendations ?? []).map(
            item => `${item.candidateId}${item.reason ? `: ${item.reason}` : ''}`
          ),
        })
      : CITY_GUIDE_RECOMMENDATION_PROMPT({
          userName: context.userName,
          loyaltyTier: context.loyaltyTier,
          intent: context.intent,
          timeOfDay: context.timeOfDay,
          radiusKm: context.radiusKm,
          preferences: context.preferences,
          history: context.userHistory,
          candidateSummary: context.candidateSummary,
          currentDate: new Date().toISOString(),
        });

    const payload = await this.generateJSON<AIRecommendationPayload>(prompt);
    const recommendations = this.mapRecommendations(payload, context.candidateMap);

    return {
      summary: payload.summary,
      followUpQuestion: payload.followUpQuestion,
      recommendations,
      generatedAt: new Date().toISOString(),
    };
  }

  private async getGuideContext(input: CityGuideRequest) {
    const radiusKm = clampRadius(input.radiusKm);
    const timeOfDay = getTimeOfDay(input.timeOfDay);
    const intent = compactText(input.intent, 'Find the best nearby spot for me right now');
    const preferences = normalizeArray(input.preferences).slice(0, 8);
    const delta = radiusKm / 111;

    const user = await prisma.user.findUnique({
      where: { id: input.userId },
      select: {
        name: true,
        loyaltyTier: true,
        savedDeals: {
          take: 5,
          orderBy: { savedAt: 'desc' },
          select: {
            deal: {
              select: {
            title: true,
                merchant: { select: { businessName: true } },
              },
            },
          },
        },
        checkIns: {
          take: 5,
          orderBy: { createdAt: 'desc' },
          select: {
            deal: {
              select: {
                title: true,
                merchant: { select: { businessName: true } },
              },
            },
          },
        },
      },
    });

    if (!user) throw new Error('User not found.');

    const now = new Date();

    const [merchants, deals, events] = await Promise.all([
      prisma.merchant.findMany({
        where: {
          status: 'APPROVED',
          latitude: { not: null, gte: input.lat - delta, lte: input.lat + delta },
          longitude: { not: null, gte: input.lng - delta, lte: input.lng + delta },
        },
        select: {
          id: true,
          businessName: true,
          description: true,
          city: true,
          latitude: true,
          longitude: true,
          vibeTags: true,
          amenities: true,
          deals: {
            where: {
              startTime: { lte: now },
              endTime: { gte: now },
            },
            select: { id: true },
            take: 6,
          },
        },
        take: 16,
      }),
      prisma.deal.findMany({
        where: {
          startTime: { lte: now },
          endTime: { gte: now },
          merchant: {
            status: 'APPROVED',
            latitude: { not: null, gte: input.lat - delta, lte: input.lat + delta },
            longitude: { not: null, gte: input.lng - delta, lte: input.lng + delta },
          },
        },
        select: {
          id: true,
          title: true,
          description: true,
          discountPercentage: true,
          discountAmount: true,
          endTime: true,
          merchant: {
            select: {
              id: true,
              businessName: true,
              city: true,
              latitude: true,
              longitude: true,
            },
          },
        },
        take: 16,
      }),
      prisma.event.findMany({
        where: {
          status: 'PUBLISHED',
          startDate: { gte: now },
          latitude: { not: null, gte: input.lat - delta, lte: input.lat + delta },
          longitude: { not: null, gte: input.lng - delta, lte: input.lng + delta },
        },
        select: {
          id: true,
          title: true,
          shortDescription: true,
          description: true,
          eventType: true,
          startDate: true,
          city: { select: { name: true } },
          venueName: true,
          latitude: true,
          longitude: true,
        },
        take: 12,
      }),
    ]);

    const merchantCandidates = merchants
      .filter(
        (merchant): merchant is typeof merchant & { latitude: number; longitude: number } =>
          merchant.latitude != null && merchant.longitude != null
      )
      .map<MerchantCandidate>(merchant => {
        const distanceKm = calculateDistanceKm(input.lat, input.lng, merchant.latitude, merchant.longitude);
        return {
          candidateId: `merchant-${merchant.id}`,
          type: 'merchant',
          merchantId: merchant.id,
          name: merchant.businessName,
          description: compactText(merchant.description, 'Local spot worth exploring nearby.'),
          distanceKm,
          latitude: merchant.latitude,
          longitude: merchant.longitude,
          city: merchant.city,
          mapUrl: buildMapUrl(merchant.latitude, merchant.longitude),
          eta: estimateEta(distanceKm),
          vibeTags: merchant.vibeTags.slice(0, 5),
          amenities: merchant.amenities.slice(0, 5),
          activeDealCount: merchant.deals.length,
        };
      })
      .filter(candidate => candidate.distanceKm <= radiusKm)
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, 8);

    const dealCandidates = deals
      .filter(
        (deal): deal is typeof deal & {
          merchant: { latitude: number; longitude: number; city: string | null };
        } => deal.merchant.latitude != null && deal.merchant.longitude != null
      )
      .map<DealCandidate>(deal => {
        const distanceKm = calculateDistanceKm(input.lat, input.lng, deal.merchant.latitude, deal.merchant.longitude);
        return {
          candidateId: `deal-${deal.id}`,
          type: 'deal',
          dealId: deal.id,
          merchantId: deal.merchant.id,
          merchantName: deal.merchant.businessName,
          name: deal.title,
          description: compactText(deal.description, 'Nearby deal available now.'),
          distanceKm,
          latitude: deal.merchant.latitude,
          longitude: deal.merchant.longitude,
          city: deal.merchant.city,
          mapUrl: buildMapUrl(deal.merchant.latitude, deal.merchant.longitude),
          eta: estimateEta(distanceKm),
          offerDisplay: formatOfferDisplay(deal.discountPercentage, deal.discountAmount),
          endTime: deal.endTime.toISOString(),
        };
      })
      .filter(candidate => candidate.distanceKm <= radiusKm)
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, 8);

    const eventCandidates = events
      .filter(
        (event): event is typeof event & { latitude: number; longitude: number } =>
          event.latitude != null && event.longitude != null
      )
      .map<EventCandidate>(event => {
        const distanceKm = calculateDistanceKm(input.lat, input.lng, event.latitude, event.longitude);
        return {
          candidateId: `event-${event.id}`,
          type: 'event',
          eventId: event.id,
          name: event.title,
          description: compactText(event.shortDescription, compactText(event.description, 'Upcoming nearby event.')),
          distanceKm,
          latitude: event.latitude,
          longitude: event.longitude,
          city: event.city?.name ?? null,
          mapUrl: buildMapUrl(event.latitude, event.longitude),
          eta: estimateEta(distanceKm),
          eventType: event.eventType,
          startDate: event.startDate.toISOString(),
          venueName: event.venueName,
        };
      })
      .filter(candidate => candidate.distanceKm <= radiusKm)
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, 6);

    const candidates = [...dealCandidates, ...merchantCandidates, ...eventCandidates];
    if (candidates.length === 0) {
      throw new Error('No nearby venues, deals, or events were found for this location.');
    }

    const candidateMap = new Map<string, CityGuideCandidate>(candidates.map(candidate => [candidate.candidateId, candidate]));
    const candidateSummary = candidates.map(candidate => this.formatCandidateForPrompt(candidate)).join('\n');

    const userHistory = [
      ...user.savedDeals.map(item => `Saved deal: ${item.deal.title} at ${item.deal.merchant.businessName}`),
      ...user.checkIns.map(item => `Checked in: ${item.deal.title} at ${item.deal.merchant.businessName}`),
    ].slice(0, 8);

    return {
      userName: compactText(user.name, 'there'),
      loyaltyTier: user.loyaltyTier,
      intent,
      timeOfDay,
      radiusKm,
      preferences,
      userHistory,
      candidateSummary,
      candidateMap,
    };
  }

  private formatCandidateForPrompt(candidate: CityGuideCandidate): string {
    const base = `- ${candidate.candidateId} | ${candidate.type} | ${candidate.name} | ${candidate.distanceKm.toFixed(2)} km away | ${candidate.description}`;

    if (candidate.type === 'deal') {
      return `${base} | merchant=${candidate.merchantName} | offer=${candidate.offerDisplay} | ends=${candidate.endTime}`;
    }

    if (candidate.type === 'merchant') {
      return `${base} | vibes=${candidate.vibeTags.join(', ') || 'none'} | amenities=${candidate.amenities.join(', ') || 'none'} | activeDeals=${candidate.activeDealCount}`;
    }

    return `${base} | eventType=${candidate.eventType} | start=${candidate.startDate} | venue=${candidate.venueName ?? 'TBD'}`;
  }

  private async generateJSON<T>(prompt: string): Promise<T> {
    const result = await proModel.generateContent(prompt);
    const raw = result.response.text();
    return JSON.parse(cleanJSON(raw)) as T;
  }

  private mapRecommendations(
    payload: AIRecommendationPayload,
    candidateMap: Map<string, CityGuideCandidate>
  ) {
    const chosen = (Array.isArray(payload.recommendations) ? payload.recommendations : [])
      .map(item => {
        const candidate = candidateMap.get(item.candidateId);
        if (!candidate) return null;

        return {
          candidateId: candidate.candidateId,
          type: candidate.type,
          title: candidate.name,
          description: candidate.description,
          reason: item.reason,
          bestFor: normalizeArray(item.bestFor).slice(0, 4),
          insiderTip: item.insiderTip,
          distanceKm: Number(candidate.distanceKm.toFixed(2)),
          city: candidate.city ?? null,
          coordinates: {
            lat: candidate.latitude,
            lng: candidate.longitude,
          },
          eta: candidate.eta,
          mapUrl: candidate.mapUrl,
          details: this.extraDetails(candidate),
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);

    if (chosen.length > 0) {
      return chosen.slice(0, 5);
    }

    return Array.from(candidateMap.values())
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, 3)
      .map(candidate => ({
        candidateId: candidate.candidateId,
        type: candidate.type,
        title: candidate.name,
        description: candidate.description,
        reason: 'This is one of the closest strong nearby options right now.',
        bestFor: ['nearby option', 'quick decision'],
        insiderTip: 'Open the map link and double-check hours before heading out.',
        distanceKm: Number(candidate.distanceKm.toFixed(2)),
        city: candidate.city ?? null,
        coordinates: {
          lat: candidate.latitude,
          lng: candidate.longitude,
        },
        eta: candidate.eta,
        mapUrl: candidate.mapUrl,
        details: this.extraDetails(candidate),
      }));
  }

  private mapItineraryStops(
    payload: AIItineraryPayload,
    candidateMap: Map<string, CityGuideCandidate>,
    maxStops: number
  ) {
    const chosen = (Array.isArray(payload.stops) ? payload.stops : [])
      .map(stop => {
        const candidate = candidateMap.get(stop.candidateId);
        if (!candidate) return null;

        return {
          candidateId: candidate.candidateId,
          type: candidate.type,
          title: candidate.name,
          reason: stop.reason,
          visitWindow: stop.visitWindow,
          distanceKm: Number(candidate.distanceKm.toFixed(2)),
          eta: candidate.eta,
          mapUrl: candidate.mapUrl,
          coordinates: {
            lat: candidate.latitude,
            lng: candidate.longitude,
          },
          details: this.extraDetails(candidate),
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);

    if (chosen.length > 0) {
      return chosen.slice(0, maxStops);
    }

    return Array.from(candidateMap.values())
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, maxStops)
      .map(candidate => ({
        candidateId: candidate.candidateId,
        type: candidate.type,
        title: candidate.name,
        reason: 'Included as a close-by stop that fits a simple route.',
        visitWindow: 'Anytime in the next 1-2 hours',
        distanceKm: Number(candidate.distanceKm.toFixed(2)),
        eta: candidate.eta,
        mapUrl: candidate.mapUrl,
        coordinates: {
          lat: candidate.latitude,
          lng: candidate.longitude,
        },
        details: this.extraDetails(candidate),
      }));
  }

  private extraDetails(candidate: CityGuideCandidate) {
    if (candidate.type === 'deal') {
      return {
        dealId: candidate.dealId,
        merchantId: candidate.merchantId,
        merchantName: candidate.merchantName,
        offerDisplay: candidate.offerDisplay,
        endsAt: candidate.endTime,
      };
    }

    if (candidate.type === 'merchant') {
      return {
        merchantId: candidate.merchantId,
        vibeTags: candidate.vibeTags,
        amenities: candidate.amenities,
        activeDealCount: candidate.activeDealCount,
      };
    }

    return {
      eventId: candidate.eventId,
      eventType: candidate.eventType,
      startDate: candidate.startDate,
      venueName: candidate.venueName,
    };
  }
}
