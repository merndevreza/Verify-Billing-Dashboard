"""
For each task end point, generate its OWN shortest path tree (/spt, distance_limit=40km),
then check which bank branch(es) fall within that road network AND within that branch's
own serving boundary (its "km" column from branches.csv).

Two separate checks per (task, branch) pair:
  1. on_network  -- does the branch snap onto the task point's road network at all
                     (within SNAP_TOLERANCE_METERS of some segment)?
  2. serving     -- is the network distance from the task point to that branch
                     ALSO within the branch's own boundary (branch.km * 1000 meters)?
                     A branch can be on_network=True but serving=False if the task
                     is reachable via the road network but farther than the branch's
                     own service radius (e.g. branch boundary is 25km but the task
                     is 27km away by road).

Workflow (per task point):
  1. Call /spt with point = task lat/lon, distance_limit = DISTANCE_LIMIT_METERS (40km).
     This 40km is just the SEARCH radius used to build the network -- it must be >=
     the largest branch boundary in branches.csv, otherwise some branches could be
     missed. Adjust DISTANCE_LIMIT_METERS if any branch's km exceeds 40.
  2. Build road-segment LineStrings from the CSV response, each tagged with its
     network distance from the task point (the /spt "distance" column).
  3. For every branch, find the nearest segment in this network and its snap distance.
     If snap distance <= SNAP_TOLERANCE_METERS -> on_network = True, and we record
     that segment's network distance as the task->branch distance.
  4. serving = on_network AND (network_distance_m <= branch's own boundary in meters).
  5. Among branches where serving == True, pick the nearest one for the summary
     columns written back onto task_points.csv.

Requires: pandas, shapely, geopandas, requests
    pip install pandas geopandas shapely requests --break-system-packages
"""

import requests
import pandas as pd
import geopandas as gpd
from shapely.geometry import LineString, Point
from shapely.strtree import STRtree

# ---------------- CONFIG ----------------

GRAPHHOPPER_URL = "http://192.168.10.105:8989/spt"
PROFILE = "car"

# How far (in meters) each task point's SPT search should extend. This just needs
# to be >= the largest branch boundary (km) in branches.csv so no branch is missed.
DISTANCE_LIMIT_METERS = 40000

# How close (in meters) a branch must be to a road segment to be considered
# "on network" (accounts for branch coordinates sitting slightly off the road,
# e.g. inside a building).
SNAP_TOLERANCE_METERS = 100

# Input files (raw column names as they exist in your actual CSVs;
# load_branches()/load_task_points() below normalize these)
BRANCHES_CSV = "./branches_74.csv"        # expects columns: title, km, Lat, Lon
TASK_POINTS_CSV = "./July26-Test.csv"  # expects columns: id, Latitude, Longitude

# -----------------------------------------


def load_branches(path):
    """Load branches.csv with columns: title, km, Lat, Lon
    -> normalize to: branch_id, lat, lon, boundary_m (branch's own serving radius, in meters)
    """
    df = pd.read_csv(path)
    df = df.rename(columns={
        "title": "branch_id",
        "Lat": "lat",
        "Lon": "lon",
    })
    df["boundary_m"] = df["km"] * 1000
    return df[["branch_id", "lat", "lon", "boundary_m"]]


def load_task_points(path):
    """Load task_points.csv with columns: DepositId (or id), Latitude, Longitude
    -> normalize to: task_id, lat, lon
    """
    df = pd.read_csv(path)
    # Handle both 'id' and 'DepositId' column names
    if "id" in df.columns:
        df = df.rename(columns={"id": "task_id"})
    elif "DepositId" in df.columns:
        df = df.rename(columns={"DepositId": "task_id"})
    else:
        raise ValueError(f"CSV must have either 'id' or 'DepositId' column. Available columns: {df.columns.tolist()}")

    df = df.rename(columns={
        "Latitude": "lat",
        "Longitude": "lon",
    })
    return df[["task_id", "lat", "lon"]]


def fetch_spt_network(lat, lon, profile, distance_limit_meters):
    """Fetch /spt rooted at (lat, lon) and return a GeoDataFrame of road segments,
    each with a 'distance_m' column = network distance from (lat, lon) to the far
    end of that segment.
    """
    url = (
        f"{GRAPHHOPPER_URL}?point={lat},{lon}"
        f"&profile={profile}"
        f"&distance_limit={distance_limit_meters}"
        f"&columns=prev_longitude,prev_latitude,longitude,latitude,distance"
    )

    resp = requests.get(url, timeout=180)
    resp.raise_for_status()

    rows = resp.text.strip().split("\n")
    lines = []
    distances = []

    # rows[0] is the header, skip it
    for row in rows[1:]:
        if not row:
            continue
        cols = row.split(",")
        prev_lon, prev_lat, lon_, lat_, distance_m = cols[0], cols[1], cols[2], cols[3], cols[4]

        # origin row has "null" for prev_* -- nothing to draw a segment to
        if prev_lon == "null" or prev_lat == "null":
            continue

        lines.append(LineString([
            (float(prev_lon), float(prev_lat)),
            (float(lon_), float(lat_)),
        ]))
        distances.append(float(distance_m))

    gdf = gpd.GeoDataFrame({"distance_m": distances}, geometry=lines, crs="EPSG:4326")
    return gdf


def find_branches_on_network(branches_df, network_gdf):
    """For every branch, find the nearest segment in network_gdf and return a
    DataFrame with: branch_id, network_distance_m, snap_distance_m, on_network,
    boundary_m, serving.

    on_network = branch is close enough to some road segment in this network
                 (within SNAP_TOLERANCE_METERS)
    serving    = on_network AND network_distance_m <= branch's own boundary_m
    """
    if len(network_gdf) == 0:
        return pd.DataFrame([{
            "branch_id": row["branch_id"],
            "network_distance_m": None,
            "snap_distance_m": None,
            "on_network": False,
            "boundary_m": row["boundary_m"],
            "serving": False,
        } for _, row in branches_df.iterrows()])

    # Project to a metric CRS for accurate distance-in-meters calculations.
    # Bangladesh is mostly UTM zone 45N / EPSG:32645.
    network_proj = network_gdf.to_crs(epsg=32645)
    tree = STRtree(network_proj.geometry.values)

    results = []
    for _, branch in branches_df.iterrows():
        point_wgs84 = gpd.GeoSeries([Point(branch["lon"], branch["lat"])], crs="EPSG:4326")
        point_proj = point_wgs84.to_crs(epsg=32645).iloc[0]

        nearest_idx = tree.nearest(point_proj)
        nearest_line = network_proj.geometry.iloc[nearest_idx]
        network_distance = network_proj["distance_m"].iloc[nearest_idx]

        snap_distance = point_proj.distance(nearest_line)
        on_network = snap_distance <= SNAP_TOLERANCE_METERS

        # serving requires BOTH on_network AND within that branch's own boundary
        serving = bool(on_network and network_distance <= branch["boundary_m"])

        results.append({
            "branch_id": branch["branch_id"],
            "network_distance_m": round(network_distance, 1) if on_network else None,
            "snap_distance_m": round(snap_distance, 1),
            "on_network": on_network,
            "boundary_m": branch["boundary_m"],
            "serving": serving,
        })

    return pd.DataFrame(results)


def main():
    branches_df = load_branches(BRANCHES_CSV)
    task_df_raw = pd.read_csv(TASK_POINTS_CSV)   # original file, all original columns kept
    task_df = load_task_points(TASK_POINTS_CSV)  # normalized lat/lon/task_id for processing

    max_boundary = branches_df["boundary_m"].max()
    if max_boundary > DISTANCE_LIMIT_METERS:
        print(
            f"WARNING: largest branch boundary ({max_boundary/1000:.1f} km) exceeds "
            f"DISTANCE_LIMIT_METERS ({DISTANCE_LIMIT_METERS/1000:.1f} km). "
            f"That branch may never be found -- increase DISTANCE_LIMIT_METERS."
        )

    nearest_branch_ids = []
    nearest_branch_distances_km = []
    served_flags = []
    second_nearest_branch_ids = []
    second_nearest_distances_km = []
    third_nearest_branch_ids = []
    third_nearest_distances_km = []

    for _, task in task_df.iterrows():
        print(f"Processing task {task['task_id']} ({task['lat']}, {task['lon']})...")
        try:
            network_gdf = fetch_spt_network(task["lat"], task["lon"], PROFILE, DISTANCE_LIMIT_METERS)
        except requests.RequestException as e:
            print(f"  WARNING: SPT fetch failed for task {task['task_id']}: {e}")
            nearest_branch_ids.append(None)
            nearest_branch_distances_km.append(None)
            served_flags.append(False)
            second_nearest_branch_ids.append(None)
            second_nearest_distances_km.append(None)
            third_nearest_branch_ids.append(None)
            third_nearest_distances_km.append(None)
            continue

        print(f"  Network has {len(network_gdf)} segments. Checking {len(branches_df)} branches...")
        branch_matches = find_branches_on_network(branches_df, network_gdf)

        # Get ALL branches on network (sorted by distance), not just serving ones
        # nearest_serving_branch_id should ALWAYS have the nearest branch
        on_network_matches = branch_matches[branch_matches["on_network"]].sort_values("network_distance_m")

        if len(on_network_matches) == 0:
            nearest_branch_ids.append(None)
            nearest_branch_distances_km.append(None)
            served_flags.append(False)
            second_nearest_branch_ids.append(None)
            second_nearest_distances_km.append(None)
            third_nearest_branch_ids.append(None)
            third_nearest_distances_km.append(None)
        else:
            # Nearest branch (always the first one)
            nearest = on_network_matches.iloc[0]
            nearest_branch_ids.append(nearest["branch_id"])
            nearest_branch_distances_km.append(round(nearest["network_distance_m"] / 1000, 2))

            # Check if served
            serving_matches = branch_matches[branch_matches["serving"]]
            served_flags.append(len(serving_matches) > 0)

            # Second nearest branch
            if len(on_network_matches) >= 2:
                second = on_network_matches.iloc[1]
                second_nearest_branch_ids.append(second["branch_id"])
                second_nearest_distances_km.append(round(second["network_distance_m"] / 1000, 2))
            else:
                second_nearest_branch_ids.append(None)
                second_nearest_distances_km.append(None)

            # Third nearest branch
            if len(on_network_matches) >= 3:
                third = on_network_matches.iloc[2]
                third_nearest_branch_ids.append(third["branch_id"])
                third_nearest_distances_km.append(round(third["network_distance_m"] / 1000, 2))
            else:
                third_nearest_branch_ids.append(None)
                third_nearest_distances_km.append(None)

    task_df["nearest_serving_branch_id"] = nearest_branch_ids
    task_df["nearest_serving_branch_distance_km"] = nearest_branch_distances_km
    task_df["served"] = served_flags
    task_df["second_nearest_branch"] = second_nearest_branch_ids
    task_df["second_nearest_branch_distance_km"] = second_nearest_distances_km
    task_df["third_nearest_branch"] = third_nearest_branch_ids
    task_df["third_nearest_branch_distance_km"] = third_nearest_distances_km

    # Merge the new columns back onto the ORIGINAL csv (with its original column names/order),
    # matching rows by task_id, then overwrite the same file.
    new_cols = [
        "nearest_serving_branch_id",
        "nearest_serving_branch_distance_km",
        "served",
        "second_nearest_branch",
        "second_nearest_branch_distance_km",
        "third_nearest_branch",
        "third_nearest_branch_distance_km"
    ]

    # Handle both 'id' and 'DepositId' for merging
    merge_key = "id" if "id" in task_df_raw.columns else "DepositId"
    task_df_raw = task_df_raw.merge(
        task_df[["task_id"] + new_cols],
        left_on=merge_key,
        right_on="task_id",
        how="left",
    ).drop(columns=["task_id"])

    task_df_raw.to_csv(TASK_POINTS_CSV, index=False)
    print(f"\nDone. Updated in place: {TASK_POINTS_CSV}")
    print(f"Served: {sum(served_flags)} / {len(served_flags)}")


if __name__ == "__main__":
    main()