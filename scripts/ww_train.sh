#!/bin/bash
#SBATCH --job-name=ww_train
#SBATCH --partition=gpu1a100
#SBATCH --nodes=1
#SBATCH --ntasks=1
#SBATCH --cpus-per-task=8
#SBATCH --gres=gpu:1
#SBATCH --time=06:00:00
#SBATCH --output=ww_train-%j.log

cd /work/wcl279/assistantSA
source /apps/anaconda3/2024.10-1/etc/profile.d/conda.sh
module load cudatoolkit/12.8.0_570.86.10
conda activate lab_env

# full run: download data, generate + augment clips, train, export onnx
python train_wake_word.py
