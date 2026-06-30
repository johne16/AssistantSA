import os
import subprocess
import sys
from pathlib import Path

import numpy as np
import scipy.io.wavfile
import yaml
import datasets
from tqdm import tqdm


def sh(cmd):
    subprocess.run(cmd, shell=True, check=True)


# Download Data

# Download room impulse responses collected by MIT
# https://mcdermottlab.mit.edu/Reverb/IR_Survey.html

output_dir = "./mit_rirs"
if not os.path.exists(output_dir):
    os.mkdir(output_dir)
if not os.listdir(output_dir):
    rir_dataset = datasets.load_dataset("davidscripka/MIT_environmental_impulse_responses", split="train", streaming=True)
    # Save clips to 16-bit PCM wav files
    for row in tqdm(rir_dataset):
        name = row['audio']['path'].split('/')[-1]
        scipy.io.wavfile.write(os.path.join(output_dir, name), 16000, (row['audio']['array'] * 32767).astype(np.int16))


# Download noise and background audio

# Audioset Dataset (https://research.google.com/audioset/dataset/index.html)
# Download one part of the audioset .tar files, extract, and convert to 16khz
# For full-scale training, it's recommended to download the entire dataset from
# https://huggingface.co/datasets/agkphysics/AudioSet, and
# even potentially combine it with other background noise datasets (e.g., FSD50k, Freesound, etc.)

output_dir = "./audioset_16k"
if not os.path.exists(output_dir):
    os.mkdir(output_dir)

# The repo moved from per-shard .tar to parquet, and its parquet feature schema
# is too new for the pinned datasets version. Read the balanced-train parquet
# shards directly, decode the embedded audio bytes, and resample to 16khz.
import io
import soundfile as sf
import pyarrow.parquet as pq
from scipy.signal import resample_poly

n_audioset_clips = 18000
audioset_base = "https://huggingface.co/datasets/agkphysics/AudioSet/resolve/main/data/bal_train"
written = len(os.listdir(output_dir))
shard = 0
while written < n_audioset_clips:
    shard_file = f"audioset_shard_{shard:02d}.parquet"
    sh(f"wget -q -O {shard_file} {audioset_base}/{shard:02d}.parquet")
    table = pq.read_table(shard_file, columns=["audio"])
    for entry in tqdm(table.column("audio").to_pylist()):
        if written >= n_audioset_clips:
            break
        data, sr = sf.read(io.BytesIO(entry["bytes"]))
        if data.ndim > 1:
            data = data.mean(axis=1)
        if sr != 16000:
            data = resample_poly(data, 16000, sr)
        name = os.path.basename(entry["path"]).rsplit(".", 1)[0] + ".wav"
        scipy.io.wavfile.write(os.path.join(output_dir, name), 16000, (data * 32767).astype(np.int16))
        written += 1
    os.remove(shard_file)
    shard += 1

# Free Music Archive dataset (https://github.com/mdeff/fma)
output_dir = "./fma"
if not os.path.exists(output_dir):
    os.mkdir(output_dir)
n_hours = 50  # use only 1 hour of clips for this example notebook, recommend increasing for full-scale training
n_fma_clips = n_hours * 3600 // 30  # FMA clips are all 30 seconds
if len(os.listdir(output_dir)) < n_fma_clips:
    fma_dataset = datasets.load_dataset("rudraml/fma", name="small", split="train", streaming=True)
    fma_dataset = iter(fma_dataset.cast_column("audio", datasets.Audio(sampling_rate=16000)))
    written = 0
    pbar = tqdm(total=n_fma_clips)
    while written < n_fma_clips:
        # next() triggers the lazy audio decode; a corrupt MP3 raises here
        try:
            row = next(fma_dataset)
        except StopIteration:
            break  # dataset exhausted before reaching target count
        except Exception:
            continue  # skip the undecodable clip and move on
        name = row['audio']['path'].split('/')[-1].replace(".mp3", ".wav")
        scipy.io.wavfile.write(os.path.join(output_dir, name), 16000, (row['audio']['array'] * 32767).astype(np.int16))
        written += 1
        pbar.update(1)
    pbar.close()


# Download pre-computed openWakeWord features for training and validation

# training set (~2,000 hours from the ACAV100M Dataset)
# See https://huggingface.co/datasets/davidscripka/openwakeword_features for more information
if not os.path.exists("openwakeword_features_ACAV100M_2000_hrs_16bit.npy"):
    sh("wget https://huggingface.co/datasets/davidscripka/openwakeword_features/resolve/main/openwakeword_features_ACAV100M_2000_hrs_16bit.npy")

# validation set for false positive rate estimation (~11 hours)
if not os.path.exists("validation_set_features.npy"):
    sh("wget https://huggingface.co/datasets/davidscripka/openwakeword_features/resolve/main/validation_set_features.npy")


# Define Training Configuration

# Load default YAML config file for training
config = yaml.load(open("openwakeword/examples/custom_model.yml", 'r').read(), yaml.Loader)


# Modify values in the config and save a new version

config["target_phrase"] = ["hey bex"]
config["model_name"] = config["target_phrase"][0].replace(" ", "_")
config["n_samples"] = 100000
config["n_samples_val"] = 5000
config["steps"] = 50000
config["target_accuracy"] = 0.6
config["target_recall"] = 0.5
config["target_false_positives_per_hour"] = 0.3

config["background_paths"] = ['./audioset_16k', './fma']  # multiple background datasets are supported
config["false_positive_validation_data_path"] = "validation_set_features.npy"
config["feature_data_files"] = {"ACAV100M_sample": "openwakeword_features_ACAV100M_2000_hrs_16bit.npy"}

with open('my_model.yaml', 'w') as file:
    documents = yaml.dump(config, file)


# Train the Model

# Step 1: Generate synthetic clips
# If generation fails, you can simply run this command again as it will continue generating until the
# number of files meets the targets specified in the config file
sh(f"{sys.executable} openwakeword/openwakeword/train.py --training_config my_model.yaml --generate_clips")

# Step 2: Augment the generated clips
sh(f"{sys.executable} openwakeword/openwakeword/train.py --training_config my_model.yaml --augment_clips")

# Step 3: Train model
sh(f"{sys.executable} openwakeword/openwakeword/train.py --training_config my_model.yaml --train_model")
