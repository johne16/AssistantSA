#!/bin/bash
#SBATCH --job-name=oww_calib
#SBATCH --partition=gpu1a100
#SBATCH --nodes=1
#SBATCH --ntasks=1
#SBATCH --cpus-per-task=8
#SBATCH --gres=gpu:1
#SBATCH --time=01:00:00
#SBATCH --output=oww_calib-%j.log

cd /work/wcl279/assistantSA
source /apps/anaconda3/2024.10-1/etc/profile.d/conda.sh
module load cudatoolkit/12.8.0_570.86.10
conda activate lab_env

# time generating 1000 positive clips only; extrapolate per-clip rate from this
time python openwakeword/openwakeword/train.py --training_config my_model.yaml --generate_clips
