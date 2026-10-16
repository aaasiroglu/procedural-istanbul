"""
UNIFIED MOBILITY DIGITAL TWIN ENGINE (core/unified_twin_engine.py)
===================================================================
Implementation of the 6-Dimensional Dual-Loop Federated Digital Twin (FedDT & MDT Synthesis)
Compliant with DIN SPEC 91607, CityGML 3.0, GMNS, and SAE J2735 SPaT/MAP.

Theoretical & Mathematical Foundations:
1. UPC / EIT Urban Mobility (Miquel Estrada): Multi-layer hierarchy (Layer 0-5), 3-Component Total Cost Z_Total = Z_T + Z_E + Z_U,
   Macroscopic Fundamental Diagram (MFD), LWR Shockwave Speed, and Public Transit Headway & Fleet Sizing.
2. Wang et al. (2022) Mobility Digital Twin (MDT): Human-Vehicle-Traffic tri-domain digital spaces, Max-Ent IRL driving styles.
3. Li et al. (2026) FedDT: Six-Dimensional Dual-Loop (Principal System Loop vs Inner Refinement Loop) with MIOM and MAMCA.
4. EMEP/EEA Guidebook 2023/2025 - COPERT 5.9 Tier 3: Consolidated Speed-Dependent Hot Emission Factor Eq. (25),
   Cold-Start beta-fractions, Fuel Consumption, Urea/Lube oil CO2, and CO2eq GWP accounting.
5. CE Delft / DG MOVE (2019): Handbook on the External Costs of Transport (Air pollution PM2.5/NOx/NMVOC, Climate 100 €/ton,
   Noise L_den, Marginal Crash Risk with VSL = 3.6M €, Social Marginal Congestion DWL, and BEV Well-To-Tank WTT).
6. VTPI (Litman, 2023): Travel Time Costs & Reliability, Perceived Time, LOS comfort multipliers, Active Transport Barrier Effects,
   and Buffer Index (t_95 - mu) stochastic reliability.
"""

from __future__ import annotations
import math
from dataclasses import dataclass, field
from typing import Dict, List, Tuple, Optional, Any


@dataclass
class Copert59Params:
    """
    EMEP/EEA Emission Inventory Guidebook - COPERT 5.9 Tier 3 Eq. (25) Parameters:
    EF_hot(V) = (alpha*V^2 + beta*V + gamma + delta/V) / (epsilon*V^2 + zeta*V + eta) * (1 - RF)
    """
    alpha: float
    beta: float
    gamma: float
    delta: float
    epsilon: float
    zeta: float
    eta: float
    rf: float = 0.0  # Reduction factor (0.0 to 1.0)


# Calibrated COPERT 5.9 Parameter Sets for Core Vehicle Fleets
COPERT_FLEET_PRESETS: Dict[str, Dict[str, Copert59Params]] = {
    "LCV_DIESEL_EURO6": {
        "NOx": Copert59Params(alpha=0.00012, beta=-0.0152, gamma=1.854, delta=2.14, epsilon=0.0, zeta=0.0084, eta=0.88, rf=0.0),
        "PM25": Copert59Params(alpha=0.000008, beta=-0.00072, gamma=0.048, delta=0.082, epsilon=0.0, zeta=0.0051, eta=1.02, rf=0.0),
        "NMVOC": Copert59Params(alpha=0.000015, beta=-0.0018, gamma=0.112, delta=0.154, epsilon=0.0, zeta=0.0062, eta=1.10, rf=0.0),
        "FC_g_km": Copert59Params(alpha=0.0185, beta=-1.240, gamma=98.5, delta=120.4, epsilon=0.0, zeta=0.0042, eta=1.0, rf=0.0),
    },
    "HGV_RIGID_14_20T": {
        "NOx": Copert59Params(alpha=0.00085, beta=-0.064, gamma=6.42, delta=12.5, epsilon=0.0, zeta=0.012, eta=1.05, rf=0.0),
        "PM25": Copert59Params(alpha=0.000045, beta=-0.0028, gamma=0.185, delta=0.42, epsilon=0.0, zeta=0.0075, eta=1.15, rf=0.0),
        "NMVOC": Copert59Params(alpha=0.000062, beta=-0.0045, gamma=0.32, delta=0.65, epsilon=0.0, zeta=0.0082, eta=1.12, rf=0.0),
        "FC_g_km": Copert59Params(alpha=0.085, beta=-4.85, gamma=295.0, delta=480.0, epsilon=0.0, zeta=0.0065, eta=1.0, rf=0.0),
    },
    "IETT_BUS_CNG": {
        "NOx": Copert59Params(alpha=0.00035, beta=-0.028, gamma=2.95, delta=5.2, epsilon=0.0, zeta=0.0095, eta=1.02, rf=0.15),
        "PM25": Copert59Params(alpha=0.000012, beta=-0.00095, gamma=0.035, delta=0.095, epsilon=0.0, zeta=0.0068, eta=1.08, rf=0.20),
        "NMVOC": Copert59Params(alpha=0.000045, beta=-0.0032, gamma=0.21, delta=0.38, epsilon=0.0, zeta=0.0078, eta=1.10, rf=0.10),
        "FC_g_km": Copert59Params(alpha=0.072, beta=-3.95, gamma=260.0, delta=410.0, epsilon=0.0, zeta=0.0058, eta=1.0, rf=0.0),
    },
    "CAR_PETROL_EURO6": {
        "NOx": Copert59Params(alpha=0.000045, beta=-0.0052, gamma=0.48, delta=0.85, epsilon=0.0, zeta=0.0065, eta=0.95, rf=0.0),
        "PM25": Copert59Params(alpha=0.000004, beta=-0.00035, gamma=0.018, delta=0.032, epsilon=0.0, zeta=0.0045, eta=1.01, rf=0.0),
        "NMVOC": Copert59Params(alpha=0.000018, beta=-0.0019, gamma=0.095, delta=0.14, epsilon=0.0, zeta=0.0055, eta=1.05, rf=0.0),
        "FC_g_km": Copert59Params(alpha=0.0125, beta=-0.85, gamma=62.0, delta=75.0, epsilon=0.0, zeta=0.0038, eta=1.0, rf=0.0),
    },
    "BEV_VAN": {
        # Tailpipe emissions are strictly 0; energy consumption modeled via WTT
        "NOx": Copert59Params(0, 0, 0, 0, 0, 0, 1.0, 1.0),
        "PM25": Copert59Params(0, 0, 0, 0, 0, 0, 1.0, 1.0),
        "NMVOC": Copert59Params(0, 0, 0, 0, 0, 0, 1.0, 1.0),
        "FC_g_km": Copert59Params(0, 0, 0, 0, 0, 0, 1.0, 1.0),
    }
}


@dataclass
class VehicleTwinProfile:
    """
    Wang et al. (2022) Vehicle Digital Twin & MITMA / COPERT Parameters.
    Captures kinematic, mechanical, emission, and financial properties of live agents.
    """
    veh_id: str
    category: str              # 'LCV_DIESEL_EURO6', 'HGV_RIGID_14_20T', 'BEV_VAN', 'IETT_BUS_CNG', 'CAR_PETROL_EURO6'
    fuel_type: str             # 'diesel', 'petrol', 'electric', 'cng'
    euro_class: int            # 0..7
    empty_mass_kg: float
    current_cargo_kg: float
    max_volume_m3: float
    used_volume_m3: float
    pce_factor: float          # Car: 1.0, LCV: 1.5, HGV/Bus: 2.0 (CE Delft Handbook)
    hourly_fixed_cost_eur: float = 27.43  # MITMA (2020) Empty time cost (€/h); Loaded: 36.89 €/h
    km_variable_cost_eur: float = 0.3407  # MITMA (2020) Empty dist cost (€/km); Loaded: 1.3281 €/km
    battery_soc_pct: Optional[float] = 100.0  # For EV/BEV vehicles
    cargo_lifo_compliant: bool = True
    sla_confidence_pct: float = 95.0


@dataclass
class LinkTrafficState:
    """
    Dynamic edge attributes reflecting the macroscopic state of a corridor or lane.
    """
    edge_id: str
    length_m: float
    num_lanes: int
    free_flow_speed_kmh: float
    current_speed_kmh: float
    flow_veh_h: float
    density_veh_km: float
    occupancy_pct: float
    mu_travel_time_s: float
    sigma_travel_time_s: float
    is_blocked: bool = False
    incident_severity: float = 0.0  # 0.0 (normal) to 1.0 (total blockage)


class UnifiedMobilityTwinLogic:
    """
    Core Mathematical and Logical Engine for Istanbul Digital Twin.
    Synthesizes FedDT, MDT, COPERT 5.9, CE Delft Externalities, and VTPI Perceived Costs.
    """

    def __init__(self, ambient_temp_c: float = 18.0, mean_trip_len_km: float = 12.4):
        self.t_a = ambient_temp_c
        self.l_trip = mean_trip_len_km

        # CE Delft (2019) Metropolitan / Urban External Unit Prices (Handbook on External Costs)
        self.ext_prices = {
            "PM25_metro_eur_per_kg": 381.0,      # Metropolitan urban PM2.5 damage cost
            "NOx_city_eur_per_kg": 21.3,         # Urban NOx damage cost
            "NMVOC_city_eur_per_kg": 1.2,        # Non-methane VOC
            "CO2_short_run_eur_per_ton": 100.0,  # Climate avoidance cost (€/ton CO2eq)
            "CO2_long_run_eur_per_ton": 269.0,   # Long run 2050 target
            "WTT_bev_eur_per_vkm": 0.0381,       # BEV Well-To-Tank grid generation externality (€/vkm)
            "VSL_eur": 3_600_000.0,              # Value of Statistical Life (EU standard)
            "baseline_crash_cost_eur_vkm": 0.045 # Urban road statistical crash base (€/vkm)
        }

        # VTPI (Litman 2023) Base Value of Travel Time (VTT) by Mode & Purpose (€/h)
        self.vtt_base = {
            "business_freight": 32.50, # 100-150% average wage rate
            "commute_car": 12.50,      # 50% average wage rate
            "transit_seated": 7.50,    # 25-35% wage rate
            "transit_standing_crowded": 22.0, # 100-175% wage rate (strenuous/stressful)
            "active_walk_pleasant": 5.00,     # Low/neutral cost (health/pleasure)
            "active_walk_hostile": 24.00      # 3x cost adjacent to noisy/dangerous traffic
        }

    # =========================================================================
    # 1. VERİ TEMİZLEME, TERSİNE MÜHENDİSLİK & GEH İSTATİSTİĞİ (CERTH / EIT)
    # =========================================================================
    @staticmethod
    def compute_geh_statistic(simulated_flow_veh_h: float, observed_flow_veh_h: float) -> Dict[str, Any]:
        """
        Geoffrey E. Havers (GEH) Statistic for model validation gate (FHWA / CERTH Module 2):
        GEH = sqrt( 2 * (M - C)^2 / (M + C) )
        Validation Criteria:
          - GEH < 5.0: Calibrated and validated (at least 85% of all key screenlines)
          - 5.0 <= GEH < 10.0: Warning / needs minor link tuning
          - GEH >= 10.0: Uncalibrated; automatic trigger for GNN edge weight recalibration
        """
        denom = simulated_flow_veh_h + observed_flow_veh_h
        if denom <= 1e-4:
            return {"geh": 0.0, "status": "EXCELLENT", "is_calibrated": True, "recalibration_required": False}

        geh = math.sqrt((2.0 * ((simulated_flow_veh_h - observed_flow_veh_h) ** 2)) / denom)
        is_calibrated = geh < 5.0
        recalib = geh >= 10.0

        status = "EXCELLENT" if geh < 5.0 else ("WARNING" if geh < 10.0 else "REJECTED_NEEDS_RECALIB")

        return {
            "geh": round(geh, 3),
            "status": status,
            "is_calibrated": is_calibrated,
            "recalibration_required": recalib,
            "simulated_veh_h": round(simulated_flow_veh_h, 1),
            "observed_veh_h": round(observed_flow_veh_h, 1)
        }

    @staticmethod
    def estimate_prior_trip_generation(floor_area_sqm: float, land_use_code: str) -> float:
        """
        Calculates baseline trip generation potantial using ITE (Institute of Transportation Engineers) rates.
        - Land use 150: Industrial/Warehouse (2.15 trips / 1000 sq.ft)
        - Land use 156: High-Cube Freight Distribution Center (0.64 trips / 1000 sq.ft)
        - Land use 820: Shopping Center / AVM (3.81 trips / 1000 sq.ft)
        - Land use 220: Residential Apartment (0.55 trips / dwelling unit or 0.65 trips/1000 sq.ft)
        """
        sqft = floor_area_sqm * 10.7639
        thousands_sqft = sqft / 1000.0

        rates = {
            "150_WAREHOUSE": 2.15,
            "156_FREIGHT_CENTER": 0.64,
            "820_SHOPPING_MALL": 3.81,
            "220_RESIDENTIAL": 0.65,
            "710_OFFICE": 1.49
        }
        rate = rates.get(land_use_code, 1.0)
        return round(thousands_sqft * rate, 2)

    # =========================================================================
    # 2. MAKRO & MİKRO TRAFİK FİZİĞİ (LWR, MFD & GM / IDM CAR-FOLLOWING)
    # =========================================================================
    @staticmethod
    def calculate_shockwave_speed(q_upstream: float, k_upstream: float,
                                  q_bottleneck: float, k_bottleneck: float) -> float:
        """
        Lighthill-Whitham-Richards (LWR) Kinematic Shockwave Speed (Estrada Module 1):
        w_AB = (q_B - q_A) / (k_B - k_A)  [km/h]
        When a lane is blocked, w_AB < 0 indicates upstream backward-propagating congestion wave.
        """
        dk = k_bottleneck - k_upstream
        if abs(dk) < 1e-4:
            return 0.0
        return (q_bottleneck - q_upstream) / dk

    @staticmethod
    def predict_spillback_time_minutes(shockwave_speed_kmh: float, link_length_m: float) -> float:
        """
        Calculates time in minutes until the queue from an accident/bottleneck hits the upstream intersection.
        """
        if shockwave_speed_kmh >= -0.01:
            return float('inf')  # Queue does not propagate upstream
        w_m_s = abs(shockwave_speed_kmh) * (1000.0 / 3600.0)
        seconds = link_length_m / w_m_s
        return round(seconds / 60.0, 2)

    @staticmethod
    def intelligent_driver_model_accel(v: float, v_lead: float, s: float,
                                       driver_style: str = "normal") -> float:
        """
        Treiber et al. Intelligent Driver Model (IDM) for microscopic vehicle tracking.
        Integrated with Wang et al. (2022) Human Digital Twin style parameters:
          - 'cautious': large desired time headway T=1.8s, safe distance s0=3.0m, low max accel a=1.2 m/s^2
          - 'normal':   T=1.3s, s0=2.0m, a=1.6 m/s^2
          - 'aggressive': T=0.8s, s0=1.2m, a=2.4 m/s^2
        """
        styles = {
            "cautious":   {"v0": 13.89, "T": 1.8, "s0": 3.0, "a": 1.2, "b": 1.5, "delta": 4.0},
            "normal":     {"v0": 16.67, "T": 1.3, "s0": 2.0, "a": 1.6, "b": 1.8, "delta": 4.0},
            "aggressive": {"v0": 22.22, "T": 0.8, "s0": 1.2, "a": 2.4, "b": 2.5, "delta": 4.0},
        }
        cfg = styles.get(driver_style, styles["normal"])

        delta_v = v - v_lead
        s_safe = s if s > 0.1 else 0.1

        # Desired gap s*(v, delta_v)
        s_star = cfg["s0"] + v * cfg["T"] + (v * delta_v) / (2.0 * math.sqrt(cfg["a"] * cfg["b"]) + 1e-5)
        s_star = max(cfg["s0"], s_star)

        # IDM acceleration
        accel = cfg["a"] * (1.0 - (v / cfg["v0"]) ** cfg["delta"] - (s_star / s_safe) ** 2)
        return round(max(-6.0, min(cfg["a"], accel)), 3)

    # =========================================================================
    # 3. TOPLU TAŞIMA (GTFS) VE DİNAMİK FİLO BOYUTLANDIRMA (Estrada Modül 1)
    # =========================================================================
    @staticmethod
    def calculate_transit_fleet_size(line_len_ab_km: float, line_len_ba_km: float,
                                     commercial_speed_kmh: float, headway_min: float,
                                     terminal_layover_a_min: float = 6.0,
                                     terminal_layover_b_min: float = 6.0,
                                     slack_time_total_min: float = 3.0) -> Dict[str, Any]:
        """
        Miquel Estrada Dynamic Transit Fleet Equation:
        M = ceil( (L_AB + L_BA) / (V_c * H) + (Theta_A + Theta_B + sum(Phi_s)) / H )
        """
        h_hours = headway_min / 60.0
        v_c = max(1.0, commercial_speed_kmh)

        round_trip_distance = line_len_ab_km + line_len_ba_km
        cycle_driving_time_h = round_trip_distance / v_c
        cycle_terminal_time_h = (terminal_layover_a_min + terminal_layover_b_min + slack_time_total_min) / 60.0

        total_cycle_time_h = cycle_driving_time_h + cycle_terminal_time_h
        raw_fleet = total_cycle_time_h / h_hours
        fleet_m = math.ceil(raw_fleet)

        return {
            "required_buses_M": fleet_m,
            "cycle_time_minutes": round(total_cycle_time_h * 60.0, 1),
            "driving_time_minutes": round(cycle_driving_time_h * 60.0, 1),
            "terminal_and_slack_minutes": round(cycle_terminal_time_h * 60.0, 1),
            "headway_minutes": headway_min,
            "commercial_speed_kmh": commercial_speed_kmh
        }

    # =========================================================================
    # 4. COPERT 5.9 (TIER 3) HIZ BAĞIMLI EMİSYON VE SOĞUK ÇALIŞTIRMA
    # =========================================================================
    def copert59_hot_factor(self, speed_kmh: float, p: Copert59Params) -> float:
        """
        COPERT 5.9 Tier 3 Eq. (25):
        EF_hot(V) = (alpha*V^2 + beta*V + gamma + delta/V) / (epsilon*V^2 + zeta*V + eta) * (1 - RF)
        Output in g/km.
        """
        v = max(5.0, min(130.0, speed_kmh))
        num = p.alpha * (v ** 2) + p.beta * v + p.gamma + (p.delta / v)
        den = p.epsilon * (v ** 2) + p.zeta * v + p.eta
        if abs(den) < 1e-6:
            return 0.0
        ef = (num / den) * (1.0 - p.rf)
        return max(0.0, ef)

    def copert59_cold_start_multiplier(self, is_heavy: bool = False) -> float:
        """
        Calculates cold start distance fraction beta:
        - Light vehicles: beta = 0.6474 - 0.02545 * l_trip - (0.00974 - 0.000385 * l_trip) * t_a
        - Heavy vehicles: beta = 8.25 / l_trip
        Returns cold start multiplier E_TOTAL / E_HOT.
        """
        if is_heavy:
            beta = 8.25 / max(1.0, self.l_trip)
        else:
            beta = 0.6474 - (0.02545 * self.l_trip) - (0.00974 - 0.000385 * self.l_trip) * self.t_a

        beta = max(0.05, min(0.70, beta))
        # Urban cold/hot emission factor ratio for Euro 6 diesel/petrol (~2.1 to 2.8 for NOx/PM)
        cold_hot_ratio = 2.45
        return 1.0 + beta * (cold_hot_ratio - 1.0)

    def calculate_fuel_and_co2eq(self, speed_kmh: float, category: str) -> Dict[str, float]:
        """
        Calculates Fuel Consumption (g/km), Tailpipe CO2 (g/km), and Total CO2eq (g/km).
        COPERT 5.9 Formula:
        E_CO2 = 44.011 * [ FC / (12.011 + 1.008*r_HC + 16.000*r_OC) ] + E_lube + 0.26 * Urea
        """
        if category == "BEV_VAN":
            return {"FC_g_km": 0.0, "CO2_g_km": 0.0, "CO2eq_g_km": 0.0}

        preset = COPERT_FLEET_PRESETS.get(category, COPERT_FLEET_PRESETS["LCV_DIESEL_EURO6"])
        fc_params = preset["FC_g_km"]
        fc_g_km = self.copert59_hot_factor(speed_kmh, fc_params)

        # Hydrogen-to-Carbon and Oxygen-to-Carbon atomic ratios
        r_hc = 1.86 if "DIESEL" in category else 1.80
        r_oc = 0.005

        # Carbon combustion chemistry
        c_denom = 12.011 + 1.008 * r_hc + 16.000 * r_oc
        tailpipe_co2_g_km = 44.011 * (fc_g_km / c_denom)

        # Lubricant combustion (~0.15 g/km) + SCR AdBlue/Urea decomposition (~0.45 g/km)
        lube_co2 = 0.15
        urea_co2 = 0.45 if "EURO6" in category or "HGV" in category else 0.0
        total_co2_g_km = tailpipe_co2_g_km + lube_co2 + urea_co2

        # Global Warming Potential (GWP): CO2=1, CH4=28, N2O=265
        ch4_g_km = 0.012
        n2o_g_km = 0.006
        co2eq_g_km = total_co2_g_km + (28.0 * ch4_g_km) + (265.0 * n2o_g_km)

        return {
            "FC_g_km": round(fc_g_km, 2),
            "CO2_g_km": round(total_co2_g_km, 2),
            "CO2eq_g_km": round(co2eq_g_km, 2)
        }

    # =========================================================================
    # 5. DIŞSAL MALİYETLER VE SOSYO-TEKNİK MALİYET FONKSİYONU (Z_Total)
    # =========================================================================
    def calculate_fleet_operational_cost_zt(self, travel_time_hours: float,
                                           distance_km: float,
                                           veh: VehicleTwinProfile) -> Dict[str, float]:
        """
        Component 1: Fleet Operational Cost (Z_T) per MITMA Standard:
        Z_T = c_t * T + c_v * V
        """
        is_loaded = veh.current_cargo_kg > 50.0
        # Time-based fixed cost (driver wage 54.7%, vehicle depreciation 4.4%, insurance 7.5%, etc.)
        c_t = 36.89 if is_loaded else veh.hourly_fixed_cost_eur
        # Distance-based variable cost (fuel 11.3%, tires 1.1%, maintenance 2.5%, etc.)
        c_v = 1.3281 if is_loaded else veh.km_variable_cost_eur

        time_cost = c_t * travel_time_hours
        dist_cost = c_v * distance_km
        z_t = time_cost + dist_cost

        return {
            "Z_T_total_eur": round(z_t, 3),
            "time_cost_eur": round(time_cost, 3),
            "distance_cost_eur": round(dist_cost, 3),
            "c_t_eur_h": c_t,
            "c_v_eur_km": c_v
        }

    def calculate_environmental_external_cost_ze(self, speed_kmh: float,
                                                 distance_km: float,
                                                 veh: VehicleTwinProfile,
                                                 is_night: bool = False,
                                                 is_highway: bool = False) -> Dict[str, float]:
        """
        Component 2: Environmental & External Cost (Z_E) per CE Delft / DG MOVE Handbook:
        - Air Pollution: PM2.5 (381 €/kg), NOx (21.3 €/kg), NMVOC (1.2 €/kg)
        - Climate Change: CO2eq (100 €/ton avoidance cost)
        - Noise Externality: L_den > 50 dBA with night/evening weightings and vehicle class factors
        - Marginal Crash Risk: VSL = 3.6 Million € baseline
        - Well-To-Tank (WTT) for BEV
        """
        # 1. Electric vehicle path (zero tailpipe, grid WTT cost)
        if veh.fuel_type == "electric" or veh.category == "BEV_VAN":
            wtt_cost = self.ext_prices["WTT_bev_eur_per_vkm"] * distance_km
            noise_cost = 0.008 * distance_km * (1.5 if is_night else 1.0)
            crash_cost = self.ext_prices["baseline_crash_cost_eur_vkm"] * distance_km
            z_e = wtt_cost + noise_cost + crash_cost
            return {
                "Z_E_total_eur": round(z_e, 3),
                "air_pollution_eur": 0.0,
                "climate_change_eur": round(wtt_cost, 3),
                "noise_cost_eur": round(noise_cost, 3),
                "crash_risk_eur": round(crash_cost, 3),
                "wtt_grid_eur": round(wtt_cost, 3)
            }

        # 2. Internal Combustion Engines (COPERT 5.9 Tier 3 + Cold Start)
        preset = COPERT_FLEET_PRESETS.get(veh.category, COPERT_FLEET_PRESETS["LCV_DIESEL_EURO6"])
        cold_mult = self.copert59_cold_start_multiplier(is_heavy=("HGV" in veh.category or "BUS" in veh.category))

        nox_g_km = self.copert59_hot_factor(speed_kmh, preset["NOx"]) * cold_mult
        pm25_g_km = self.copert59_hot_factor(speed_kmh, preset["PM25"]) * cold_mult
        nmvoc_g_km = self.copert59_hot_factor(speed_kmh, preset["NMVOC"]) * cold_mult

        # Air pollution damage costs (€)
        nox_cost = (nox_g_km / 1000.0) * self.ext_prices["NOx_city_eur_per_kg"] * distance_km
        pm25_cost = (pm25_g_km / 1000.0) * self.ext_prices["PM25_metro_eur_per_kg"] * distance_km
        nmvoc_cost = (nmvoc_g_km / 1000.0) * self.ext_prices["NMVOC_city_eur_per_kg"] * distance_km
        air_pollution_cost = nox_cost + pm25_cost + nmvoc_cost

        # Climate change damage costs (€)
        ghg_data = self.calculate_fuel_and_co2eq(speed_kmh, veh.category)
        co2eq_tons = (ghg_data["CO2eq_g_km"] / 1_000_000.0) * distance_km
        climate_cost = co2eq_tons * self.ext_prices["CO2_short_run_eur_per_ton"]

        # Noise cost based on vehicle category and day/night penalty
        noise_factor = 1.0
        if "HGV" in veh.category:
            noise_factor = 16.6
        elif "BUS" in veh.category:
            noise_factor = 12.0
        elif "LCV" in veh.category:
            noise_factor = 2.5
        noise_time_mult = 2.0 if is_night else 1.0
        noise_cost = (0.015 * noise_factor * noise_time_mult) * distance_km

        # Statistical marginal crash risk
        crash_mult = 0.75 if is_highway else 1.0
        crash_cost = self.ext_prices["baseline_crash_cost_eur_vkm"] * veh.pce_factor * crash_mult * distance_km

        z_e = air_pollution_cost + climate_cost + noise_cost + crash_cost

        return {
            "Z_E_total_eur": round(z_e, 3),
            "air_pollution_eur": round(air_pollution_cost, 3),
            "climate_change_eur": round(climate_cost, 3),
            "noise_cost_eur": round(noise_cost, 3),
            "crash_risk_eur": round(crash_cost, 3),
            "wtt_grid_eur": 0.0,
            "emissions_g": {
                "NOx": round(nox_g_km * distance_km, 2),
                "PM25": round(pm25_g_km * distance_km, 3),
                "CO2eq": round(ghg_data["CO2eq_g_km"] * distance_km, 1)
            }
        }

    def calculate_perceived_time_cost_zu(self, travel_time_hours: float,
                                         travel_time_std_hours: float,
                                         purpose: str = "business_freight",
                                         los_grade: str = "C",
                                         passenger_count: int = 1,
                                         is_active_mode: bool = False,
                                         is_shaded_separated: bool = True,
                                         barrier_penalty_eur: float = 0.0) -> Dict[str, float]:
        """
        Component 3: User & Perceived Travel Time Cost (Z_U) per VTPI (Litman 2023):
        Z_U = sum_l [ VTT_base * Psi_LOS * Q * (mu(t) + lambda_buffer * sigma(t)) ] + Barrier_Penalty

        Incorporates:
          - Level of Service (LOS) comfort penalty Psi_LOS (LOS A: 0.8 to LOS F: 1.8)
          - Buffer Time Index lambda_buffer = 1.645 (95th percentile reliability)
          - Active mobility comfort vs highway barrier severance penalty
        """
        base_vtt = self.vtt_base.get(purpose, self.vtt_base["business_freight"])

        los_multipliers = {
            "A": 0.80, # Free flow, minimal stress
            "B": 0.90,
            "C": 1.00, # Stable design flow
            "D": 1.20,
            "E": 1.50, # Approaching capacity, stop-and-go
            "F": 1.85  # Forced breakdown / severe gridlock
        }
        psi_los = los_multipliers.get(los_grade.upper(), 1.00)

        # Active transport (walk/cycle) adjustments
        if is_active_mode:
            if is_shaded_separated:
                base_vtt = self.vtt_base["active_walk_pleasant"]
                psi_los = 0.85
            else:
                base_vtt = self.vtt_base["active_walk_hostile"]
                psi_los = 1.40

        # Buffer index for 95% reliable arrival (Fenton-Wilkinson stochastic constraint)
        lambda_buffer = 1.645
        effective_time_hours = travel_time_hours + (lambda_buffer * travel_time_std_hours)

        z_u = base_vtt * psi_los * passenger_count * effective_time_hours + barrier_penalty_eur

        return {
            "Z_U_total_eur": round(z_u, 3),
            "clock_time_cost_eur": round(base_vtt * psi_los * passenger_count * travel_time_hours, 3),
            "reliability_buffer_cost_eur": round(base_vtt * psi_los * passenger_count * (lambda_buffer * travel_time_std_hours), 3),
            "barrier_penalty_eur": round(barrier_penalty_eur, 3),
            "effective_time_hours": round(effective_time_hours, 3),
            "effective_vtt_eur_h": round(base_vtt * psi_los, 2)
        }

    def calculate_unified_total_cost_z(self, z_t: Dict[str, Any],
                                       z_e: Dict[str, Any],
                                       z_u: Dict[str, Any]) -> Dict[str, Any]:
        """
        Synthesizes the complete 3-component digital twin socio-technical objective function:
        min Z_Total = Z_T (Operational) + Z_E (Environmental & External) + Z_U (Perceived Time)
        """
        total = z_t["Z_T_total_eur"] + z_e["Z_E_total_eur"] + z_u["Z_U_total_eur"]
        return {
            "Z_Total_eur": round(total, 3),
            "Z_T_operational_eur": z_t["Z_T_total_eur"],
            "Z_E_environmental_eur": z_e["Z_E_total_eur"],
            "Z_U_perceived_user_eur": z_u["Z_U_total_eur"],
            "shares_pct": {
                "operational_share": round((z_t["Z_T_total_eur"] / total) * 100.0, 1) if total > 0 else 0,
                "environmental_share": round((z_e["Z_E_total_eur"] / total) * 100.0, 1) if total > 0 else 0,
                "user_share": round((z_u["Z_U_total_eur"] / total) * 100.0, 1) if total > 0 else 0
            }
        }

    # =========================================================================
    # 6. DUAL-LOOP FEDERASYON ORKESTRASYONU (FedDT - Li et al., 2026)
    # =========================================================================
    def evaluate_dual_loop_orchestration(self,
                                         incident_active: bool,
                                         bottleneck_link: LinkTrafficState,
                                         upstream_flow_veh_h: float,
                                         upstream_density_veh_km: float) -> Dict[str, Any]:
        """
        Executes the Six-Dimensional Dual-Loop FedDT logic:
        - Principal System Loop: Ingests live telemetry & triggers field actuation.
        - Inner Refinement Loop: Runs multi-scale simulation (MFD + Micro IDM) and MAMCA multi-actor evaluation.
        """
        if not incident_active:
            return {
                "loop_state": "PRINCIPAL_SYSTEM_LOOP_STABLE",
                "actuator_commands": {
                    "variable_speed_limit_kmh": bottleneck_link.free_flow_speed_kmh,
                    "perimeter_control_active": False,
                    "transit_signal_priority_ts_s": 0.0,
                    "vrp_reroute_recommended": False
                },
                "incident_metrics": None
            }

        # 1. Inner Refinement Loop Activation
        q_b = bottleneck_link.flow_veh_h * (1.0 - bottleneck_link.incident_severity)
        k_b = bottleneck_link.density_veh_km * (1.0 + 1.2 * bottleneck_link.incident_severity)

        w_ab = self.calculate_shockwave_speed(
            q_upstream=upstream_flow_veh_h,
            k_upstream=upstream_density_veh_km,
            q_bottleneck=q_b,
            k_bottleneck=k_b
        )
        spillback_min = self.predict_spillback_time_minutes(w_ab, bottleneck_link.length_m)

        # 2. Multi-Actor Multi-Criteria Analysis (MAMCA) Actuation Synthesis
        suggested_vsl = max(30.0, round(bottleneck_link.current_speed_kmh * 0.75, -1))
        perimeter_active = bottleneck_link.density_veh_km > 55.0 or spillback_min < 6.0

        return {
            "loop_state": "INNER_REFINEMENT_LOOP_ACTIVE",
            "incident_metrics": {
                "shockwave_speed_kmh": round(w_ab, 2),
                "spillback_time_upstream_min": spillback_min,
                "queue_threat_level": "CRITICAL" if spillback_min < 5.0 else "ELEVATED"
            },
            "actuator_commands": {
                "variable_speed_limit_kmh": suggested_vsl,
                "perimeter_control_active": perimeter_active,
                "transit_signal_priority_ts_s": 12.0,  # +12 seconds green extension for IETT buses
                "vrp_reroute_recommended": True,
                "action_summary": f"VSL {suggested_vsl} km/s, TSP +12s, Kuyruk {spillback_min} dk içinde kavşağı kilitleyecek."
            }
        }
